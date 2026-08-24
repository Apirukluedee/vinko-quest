/* ============================================================
   POST /api/omise-webhook

   จุดที่ห้ามพลาดที่สุดของระบบ หลักการ 3 ข้อ:

   1. ห้ามเชื่อ payload ที่ยิงเข้ามา — อ่านแค่ charge id
      แล้วเรียก Omise API ดึง charge จริงมาตรวจเองด้วย secret key
      ถ้าเชื่อ payload ตรงๆ ใครก็ยิง request ปลอมมาบอกว่าจ่ายแล้วได้

   2. กันซ้ำด้วย unique constraint บน webhook_events.omise_event_id
      insert ก่อนทำงานเสมอ ถ้าชน = เคยประมวลผลแล้ว ตอบ 200 จบทันที

   3. ตอบ 200 ให้เร็วที่สุด งานหนักไปทำใน request แยก (รอบ 3B)
      ถ้าตอบช้า Omise จะ retry แล้วจะยุ่ง
   ============================================================ */

'use strict';

const omise  = require('./_lib/omise');
const db     = require('./_lib/supabase');
const orders = require('./_lib/orders');
const line   = require('./_lib/line');
const { json, requireEnv } = require('./_lib/util');
const config = require('./_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  try {
    requireEnv(['OMISE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    console.error('[vinko][webhook]', e.message);
    return json(res, 500, { ok: false });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body || typeof body !== 'object') return json(res, 400, { ok: false });

  const eventId = typeof body.id === 'string' ? body.id : null;
  const chargeId = extractChargeId(body);

  if (!eventId || !chargeId) {
    console.warn('[vinko][webhook] payload ไม่มี event id หรือ charge id');
    return json(res, 400, { ok: false });
  }

  /* ---------- กันซ้ำก่อนทำงาน ---------- */
  // เก็บเฉพาะ id ที่จำเป็น ไม่เก็บ payload ดิบทั้งก้อนโดยไม่จำเป็น
  const claim = await db.insert('webhook_events', {
    omise_event_id: eventId,
    payload: { key: body.key || null, charge_id: chargeId }
  });

  if (!claim.ok) {
    if (db.isUniqueViolation(claim)) {
      // เคยประมวลผล event นี้ไปแล้ว ห้ามทำงานซ้ำ
      return json(res, 200, { ok: true, duplicate: true });
    }
    console.error('[vinko][webhook] บันทึก event ไม่สำเร็จ', JSON.stringify(claim.body));
    // ตอบ 500 เพื่อให้ Omise retry ดีกว่าปล่อยให้ออเดอร์ค้าง pending
    return json(res, 500, { ok: false });
  }

  /* ---------- ดึง charge จริงมาตรวจเอง ---------- */
  let charge;
  try {
    const r = await omise.retrieveCharge(chargeId);
    if (!r.ok || !r.body || r.body.object !== 'charge' || !r.body.id) {
      // charge id ที่ไม่มีจริง = webhook ปลอม ปฏิเสธ ไม่แตะออเดอร์
      console.warn('[vinko][webhook] ไม่พบ charge นี้ที่ Omise:', chargeId);
      return json(res, 200, { ok: true, ignored: 'charge_not_found' });
    }
    charge = r.body;
  } catch (e) {
    console.error('[vinko][webhook] เรียก Omise ไม่สำเร็จ', e.message);
    return json(res, 500, { ok: false });
  }

  /* ---------- อัปเดตออเดอร์ ---------- */
  // รองรับทั้งสำเร็จ ล้มเหลว และหมดอายุ (QR PromptPay มีอายุจำกัด)
  try {
    const result = await orders.applyChargeResult(charge);

    // จ่ายสำเร็จ: สั่งส่งมอบไฟล์ + แจ้งเตือน LINE แต่ไม่รอผล เพื่อให้ตอบ 200 กลับ Omise ทันที
    // ถ้าตอบช้า Omise จะ retry แล้วจะยุ่ง
    if (result && result.needs_delivery) {
      triggerDelivery(result.order_ref);
      line.notifyOrder(result.order_ref).catch(function () {});
    }

    return json(res, 200, { ok: true, result: result });
  } catch (e) {
    console.error('[vinko][webhook] อัปเดตออเดอร์ไม่สำเร็จ', e.message);
    return json(res, 500, { ok: false });
  }
};

/**
 * ยิงไปที่ /api/deliver-order แบบไม่รอผล
 *
 * ถ้าส่งอีเมลล้มเหลว ห้ามให้ออเดอร์กลายเป็น failed เด็ดขาด — ลูกค้าจ่ายเงินแล้ว
 * ความล้มเหลวถูกบันทึกไว้ใน email_events และกดส่งซ้ำได้ที่ /api/admin/resend-email
 */
function triggerDelivery(orderRef) {
  const base = config.appBaseUrl();
  const secret = config.internalTaskSecret();
  if (!base || !secret) {
    console.error('[vinko][webhook] ยังไม่ได้ตั้ง APP_BASE_URL หรือ INTERNAL_TASK_SECRET — ข้ามการส่งอีเมล', orderRef);
    return;
  }
  fetch(base + '/api/deliver-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vinko-task': secret },
    body: JSON.stringify({ order_ref: orderRef })
  }).catch(function (e) {
    console.error('[vinko][webhook] เรียก deliver-order ไม่สำเร็จ', orderRef, e.message);
  });
}

/**
 * ดึง charge id ออกจาก payload — เอาแค่ "ตัวชี้" เท่านั้น
 * ข้อมูลสถานะและยอดเงินใน payload ถูกทิ้งทั้งหมด เพราะปลอมได้
 */
function extractChargeId(body) {
  const d = body.data;
  if (!d || typeof d !== 'object') return null;
  if (d.object === 'charge' && typeof d.id === 'string') return d.id;
  // event บาง type ห่อ charge ไว้อีกชั้น เช่น refund
  if (d.charge && typeof d.charge === 'string') return d.charge;
  if (d.charge && typeof d.charge === 'object' && typeof d.charge.id === 'string') return d.charge.id;
  return null;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
