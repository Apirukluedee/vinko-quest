/* ============================================================
   บันทึกการคืนเงินและตัดสิทธิ์ดาวน์โหลด

   ตัวนี้ "ไม่ได้" สั่งคืนเงิน — เจ้าของกดคืนเองที่แดชบอร์ด Omise
   ซึ่งเป็นที่ที่มีการยืนยันตัวตนของเจ้าของอยู่แล้ว หน้าที่ของไฟล์นี้คือ
   ตามเก็บผลที่ตามมา: ปิดสิทธิ์โหลด หยุดส่งของที่ค้าง และบันทึกหลักฐาน

   ที่สำคัญคือ **ยืนยันกับ Omise ก่อนเสมอ** ว่ามีการคืนเงินเกิดขึ้นจริง
   ห้ามเชื่อคนที่เรียก endpoint เข้ามา ไม่งั้นใครที่หลุด ADMIN_SECRET ไป
   จะสั่งปิดสิทธิ์ลูกค้าที่จ่ายเงินมาแล้วได้ทั้งระบบ
   ============================================================ */

'use strict';

const db     = require('./supabase');
const omise  = require('./omise');
const tokens = require('./tokens');

/** ยอดที่ Omise บอกว่าคืนไปแล้วจริง (สตางค์) */
function refundedSatang(charge) {
  if (!charge) return 0;
  const n = Number(charge.refunded_amount != null ? charge.refunded_amount : charge.refunded);
  return Number.isFinite(n) ? n : 0;
}

/**
 * คืนเงินแล้วบันทึกผล
 *
 * @param {string} orderRef
 * @param {object} opts
 *   scope  'full'     ปิดสิทธิ์ทั้งออเดอร์ (ค่าเริ่มต้น)
 *          'preorder' คืนเฉพาะนิทานที่ยังไม่ได้ส่ง ของที่ส่งไปแล้วยังโหลดได้
 *   note   เหตุผล เก็บไว้ดูย้อนหลัง
 */
async function record(orderRef, opts) {
  const scope = (opts && opts.scope) === 'preorder' ? 'preorder' : 'full';
  const note  = String((opts && opts.note) || '').slice(0, 500);

  const r = await db.select(
    'orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) +
    '&select=id,order_ref,status,amount_satang,omise_charge_id,refunded_at,customer_email&limit=1'
  );
  const order = Array.isArray(r.body) && r.body[0];
  if (!order) return { ok: false, error: 'ไม่พบคำสั่งซื้อนี้' };

  if (order.refunded_at && scope === 'full') {
    return { ok: true, already: true, order_ref: order.order_ref,
             message: 'ออเดอร์นี้บันทึกการคืนเงินไว้แล้ว' };
  }
  if (!order.omise_charge_id) {
    return { ok: false, error: 'ออเดอร์นี้ไม่มีเลข charge ของ Omise จึงตรวจสอบไม่ได้' };
  }

  /* ---- ยืนยันกับ Omise ว่าคืนจริง ---- */
  const c = await omise.retrieveCharge(order.omise_charge_id);
  if (!c.ok) {
    return { ok: false, error: 'อ่านข้อมูลจาก Omise ไม่สำเร็จ (' + c.status + ')' };
  }
  const refunded = refundedSatang(c.body);
  if (refunded <= 0) {
    return {
      ok: false,
      error: 'Omise ยังไม่มีรายการคืนเงินของ charge นี้ — ' +
             'กรุณากดคืนเงินที่แดชบอร์ด Omise ให้เรียบร้อยก่อน แล้วค่อยเรียกซ้ำ'
    };
  }

  const now = new Date().toISOString();

  if (scope === 'full') {
    /* ปิดสิทธิ์ทันที: ล้าง token ทิ้งและเปลี่ยนสถานะ
       ล้าง token ด้วยเพราะ tokens.resolve() หา order จาก token เป็นหลัก
       ตัดที่ต้นทางจึงแน่นอนกว่าพึ่งการเช็ค status อย่างเดียว */
    const up = await db.update('orders', 'id=eq.' + order.id, {
      status: 'refunded',
      refunded_at: now,
      refund_satang: refunded,
      refund_note: note || null,
      download_token: null,
      token_expires_at: null
    });
    if (!up.ok) return { ok: false, error: 'บันทึกลงฐานข้อมูลไม่สำเร็จ' };

    await db.update('order_items', 'order_id=eq.' + order.id + '&refunded_at=is.null',
                    { refunded_at: now });

    return { ok: true, order_ref: order.order_ref, scope: scope,
             refund_satang: refunded, items_revoked: 'ทั้งหมด' };
  }

  /* ---- คืนเฉพาะนิทานที่ยังไม่ได้ส่ง ---- */
  const items = await tokens.itemsFor(order.id);
  const target = items.filter(function (i) {
    return i.delivery_type === 'preorder' && !i.delivered_at && !i.refunded_at;
  });
  if (!target.length) {
    return { ok: false, error: 'ไม่มีรายการ pre-order ที่ยังไม่ได้ส่งให้คืน' };
  }

  for (const it of target) {
    await db.update('order_items', 'id=eq.' + it.id, { refunded_at: now });
  }

  const prev = order.refund_satang || 0;
  await db.update('orders', 'id=eq.' + order.id, {
    refunded_at: now,
    refund_satang: refunded > prev ? refunded : prev,
    refund_note: note || null
  });

  return {
    ok: true, order_ref: order.order_ref, scope: scope,
    refund_satang: refunded,
    items_revoked: target.map(function (i) { return i.product_code; })
  };
}

/** ดูสถานะการคืนเงินของออเดอร์ ใช้ตรวจก่อน/หลังทำ */
async function status(orderRef) {
  const r = await db.select(
    'orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) +
    '&select=id,order_ref,status,amount_satang,omise_charge_id,refunded_at,refund_satang,refund_note&limit=1'
  );
  const order = Array.isArray(r.body) && r.body[0];
  if (!order) return { ok: false, error: 'ไม่พบคำสั่งซื้อนี้' };

  let omiseRefunded = null;
  if (order.omise_charge_id) {
    const c = await omise.retrieveCharge(order.omise_charge_id);
    if (c.ok) omiseRefunded = refundedSatang(c.body);
  }

  const items = await tokens.itemsFor(order.id);
  return {
    ok: true,
    order_ref: order.order_ref,
    status: order.status,
    amount_satang: order.amount_satang,
    refunded_at: order.refunded_at,
    refund_satang_in_db: order.refund_satang,
    refund_satang_in_omise: omiseRefunded,
    items: items.map(function (i) {
      return {
        product_code: i.product_code,
        delivered: !!i.delivered_at,
        refunded: !!i.refunded_at
      };
    })
  };
}

module.exports = { record, status, refundedSatang };
