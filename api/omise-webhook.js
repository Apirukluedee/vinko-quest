/* ============================================================
   POST /api/omise-webhook

   จุดที่ห้ามพลาดที่สุดของระบบ หลักการ 3 ข้อ:

   1. ห้ามเชื่อ payload ที่ยิงเข้ามา — อ่านแค่ charge id
      แล้วเรียก Omise API ดึง charge จริงมาตรวจเองด้วย secret key
      ถ้าเชื่อ payload ตรงๆ ใครก็ยิง request ปลอมมาบอกว่าจ่ายแล้วได้

   2. กันซ้ำด้วย unique constraint บน webhook_events.omise_event_id
      insert ก่อนทำงานเสมอ ถ้าชน = เคยประมวลผลแล้ว ตอบ 200 จบทันที

   3. ส่งมอบให้เสร็จก่อนตอบ 200 — ล้มเมื่อไรตอบ 500 ให้ Omise ส่งซ้ำ
      ทุกขั้นทำซ้ำได้ปลอดภัย (ดูหมายเหตุในตัว handler)
   ============================================================ */

'use strict';

const crypto = require('crypto');
const omise  = require('./_lib/omise');
const db     = require('./_lib/supabase');
const orders = require('./_lib/orders');
const line   = require('./_lib/line');
const metaCapi = require('./_lib/meta-capi');
const { deliver } = require('./_lib/deliver-order');
const { json, requireEnv } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  try {
    requireEnv(['OMISE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    console.error('[vinko][webhook]', e.message);
    return json(res, 500, { ok: false });
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body || typeof body !== 'object') return json(res, 400, { ok: false });

  /* ---------- ตรวจ HMAC signature (เมื่อมี OMISE_WEBHOOK_SECRET ใน env) ---------- */
  const webhookSecret = process.env.OMISE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sig = (req.headers['x-opn-signature'] || req.headers['omise-webhook-signature'] || '').trim();
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    if (!sig || sig !== expected) {
      console.warn('[vinko][webhook] signature ไม่ตรง — ปฏิเสธ request');
      return json(res, 400, { ok: false, error: 'invalid signature' });
    }
  }

  const eventId = typeof body.id === 'string' ? body.id : null;
  const chargeId = extractChargeId(body);

  if (!eventId || !chargeId) {
    console.warn('[vinko][webhook] payload ไม่มี event id หรือ charge id');
    return json(res, 400, { ok: false });
  }

  /* ---------- ดึง charge จริงมาตรวจก่อน แล้วค่อยกัน dup ---------- */
  // ย้าย retrieveCharge มาก่อน insert dedup เพื่อให้ Omise retry ได้เมื่อเกิด error ชั่วคราว
  // ถ้า insert dedup อยู่ก่อนแล้วเกิด error หลังจากนั้น Omise retry จะชน unique constraint
  // และ event จะถูกล็อคถาวรโดยไม่มีการส่งมอบ
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

  /* ---------- กันซ้ำหลังยืนยัน charge แล้ว ---------- */
  // เก็บเฉพาะ id ที่จำเป็น ไม่เก็บ payload ดิบทั้งก้อนโดยไม่จำเป็น
  const claim = await db.insert('webhook_events', {
    omise_event_id: eventId,
    payload: { key: body.key || null, charge_id: chargeId }
  });

  if (!claim.ok) {
    if (db.isUniqueViolation(claim)) {
      // เคยประมวลผลสำเร็จแล้ว — รอบที่ล้มจะลบแถวนี้ทิ้งเสมอ (ดู releaseClaim)
      // แถวที่ยังอยู่จึงหมายถึงจบงานแล้วเท่านั้น
      return json(res, 200, { ok: true, duplicate: true });
    }
    console.error('[vinko][webhook] บันทึก event ไม่สำเร็จ status', claim.status);
    // ตอบ 500 เพื่อให้ Omise retry ดีกว่าปล่อยให้ออเดอร์ค้าง pending
    return json(res, 500, { ok: false });
  }

  /* ---------- อัปเดตออเดอร์ + ส่งมอบ ----------
     รองรับทั้งสำเร็จ ล้มเหลว และหมดอายุ (QR PromptPay มีอายุจำกัด)

     ล้มตรงไหนก็ตาม: ลบแถวกันซ้ำทิ้ง แล้วตอบ 500 ให้ Omise ส่ง event เดิมมาใหม่
     รอบใหม่จะทำซ้ำได้ปลอดภัย — applyChargeResult ไม่แตะออเดอร์ที่ paid แล้ว
     และ deliver() ไม่ส่งอีเมลซ้ำถ้าเคยส่งสำเร็จ
     ถ้าลบแถวไม่ได้ (DB ล่มทั้งระบบ) cron รายวันจะไล่ซ่อมให้ (api/cron/deliver-preorders.js)

     ต้อง await ทุกอย่าง ห้ามยิงทิ้งแล้วรีบตอบ 200
     เพราะ Vercel หยุดการทำงานของฟังก์ชันทันทีที่ตอบ response ออกไป
     (เคยพลาดตรงนี้มาแล้วกับออเดอร์ VK-2608-0001) */
  let result;
  try {
    result = await orders.applyChargeResult(charge);
  } catch (e) {
    console.error('[vinko][webhook] อัปเดตออเดอร์ไม่สำเร็จ', e.message);
    await releaseClaim(eventId);
    return json(res, 500, { ok: false });
  }

  // จ่ายแล้ว (รอบนี้ หรือรอบก่อนที่ส่งของไม่สำเร็จ หรือ create-charge ตั้ง paid ไว้แล้ว)
  // → ส่งมอบเสมอ deliver() ข้ามเองถ้าเคยส่งอีเมลแล้ว
  if (result && result.status === 'paid') {
    const out = await deliver(result.order_ref).catch(function (e) {
      return { ok: false, error: e.message };
    });
    // อีเมลส่งไม่ออก = ยังไม่ถือว่าส่งมอบ (ลิงก์ดาวน์โหลดอยู่ในอีเมล)
    const delivered = out.ok === true && out.emailed !== false;

    if (result.changed) {
      // LINE แจ้งแอดมิน — ไม่ critical แต่ต้อง await เหตุผลเดียวกับ deliver
      await line.notifyOrder(result.order_ref).catch(function (e) {
        console.error('[vinko][webhook] แจ้งเตือน LINE ไม่สำเร็จ', result.order_ref, e.message);
      });
      // Meta CAPI เฉพาะรอบที่เปลี่ยนเป็น paid — ไม่ throw, timeout 2 วินาที
      // ส่งแม้ส่งมอบล้ม: การซื้อเกิดขึ้นจริงแล้ว และรอบ retry จะไม่ผ่านจุด changed อีก
      await metaCapi.sendPurchase(result.order_ref, charge);
    }

    if (!delivered) {
      // log เฉพาะเหตุผลแบบสั้น ไม่ log ข้อความ error จากผู้ให้บริการอีเมล
      console.error('[vinko][webhook] ส่งมอบไม่สำเร็จ', result.order_ref,
        out.ok !== true ? 'deliver_failed' : 'email_failed');
      await releaseClaim(eventId);
      return json(res, 500, { ok: false, error: 'deliver_failed' });
    }
  }

  return json(res, 200, { ok: true, result: result });
};

/**
 * ลบแถวกันซ้ำของ event ที่ประมวลผลไม่สำเร็จ ให้ Omise retry แล้วทำใหม่ได้
 * ล้มเองก็ไม่ throw — แค่ log ไว้ cron รายวันเป็นด่านสุดท้าย
 */
async function releaseClaim(eventId) {
  try {
    const r = await db.remove('webhook_events', 'omise_event_id=eq.' + encodeURIComponent(eventId));
    if (!r.ok) console.error('[vinko][webhook] ลบแถวกันซ้ำไม่สำเร็จ status', r.status);
  } catch (e) {
    console.error('[vinko][webhook] ลบแถวกันซ้ำไม่สำเร็จ', e.message);
  }
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
