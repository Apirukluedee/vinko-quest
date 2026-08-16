/* ============================================================
   ตรรกะเปลี่ยนสถานะออเดอร์จากผลของ charge
   ใช้ร่วมกันระหว่าง /api/omise-webhook และ /api/create-charge
   (บัตรจ่ายสำเร็จทันทีตั้งแต่ตอนสร้าง charge จึงอัปเดตได้เลย
    แต่ webhook ยังเป็นตัวยืนยันหลักและเรียกซ้ำได้โดยไม่พัง)
   ============================================================ */

'use strict';

const db = require('./supabase');

const STATUS_FROM_CHARGE = {
  successful: 'paid',
  failed: 'failed',
  expired: 'expired',
  reversed: 'failed'
};

/**
 * อัปเดตออเดอร์ตามผลของ charge จริงที่ดึงมาจาก Omise
 * ปลอดภัยต่อการเรียกซ้ำ: ออเดอร์ที่เป็น paid แล้วจะไม่ถูกแตะอีก
 *
 * @param charge object ที่ได้จาก omise.retrieveCharge() เท่านั้น
 *               ห้ามส่ง payload ที่มาจาก request ภายนอกเข้ามาตรงๆ
 */
async function applyChargeResult(charge) {
  if (!charge || !charge.id) return { handled: false, reason: 'no_charge' };

  const sel = await db.select(
    'orders',
    'omise_charge_id=eq.' + encodeURIComponent(charge.id) +
    '&select=id,order_ref,status,amount_satang,currency'
  );
  const order = Array.isArray(sel.body) && sel.body[0];
  if (!order) return { handled: false, reason: 'order_not_found' };

  // เคยจบไปแล้ว ไม่ต้องทำอะไรซ้ำ
  if (order.status === 'paid' || order.status === 'refunded') {
    return { handled: true, already: true, order_ref: order.order_ref, status: order.status };
  }

  const next = STATUS_FROM_CHARGE[charge.status];
  if (!next) return { handled: false, reason: 'charge_pending', order_ref: order.order_ref };

  // จ่ายสำเร็จแต่ยอดไม่ตรงกับที่สั่ง = ห้ามตั้งเป็น paid เด็ดขาด
  // บันทึกไว้เป็นเคสต้องตรวจสอบด้วยคน
  if (next === 'paid') {
    const paidAmount = Number(charge.amount);
    const paidCurrency = String(charge.currency || '').toUpperCase();
    if (paidAmount !== Number(order.amount_satang) || paidCurrency !== String(order.currency).toUpperCase()) {
      const note = 'ยอดไม่ตรง: charge=' + paidAmount + ' ' + paidCurrency +
                   ' / order=' + order.amount_satang + ' ' + order.currency;
      console.error('[vinko][AMOUNT_MISMATCH]', order.order_ref, note);
      await db.update('orders', 'id=eq.' + order.id, {
        amount_mismatch_note: note.slice(0, 500)
      });
      return { handled: true, mismatch: true, order_ref: order.order_ref, status: order.status };
    }
  }

  const patch = { status: next };
  if (next === 'paid') {
    patch.paid_at = new Date().toISOString();
    if (charge.source && charge.source.type === 'promptpay') patch.payment_method = 'promptpay';
    else if (charge.card) patch.payment_method = 'card';
  }

  // เปลี่ยนสถานะเฉพาะตอนที่ยังเป็น pending เท่านั้น (กัน race ระหว่าง webhook หลายตัว)
  const upd = await db.update('orders', 'id=eq.' + order.id + '&status=eq.pending', patch);
  const changed = Array.isArray(upd.body) && upd.body.length > 0;

  // TODO: round 3B — ตรงนี้คือจุดที่จะสั่งทำ watermark และส่งอีเมลลิงก์ดาวน์โหลด
  //                  ต้องยิงเป็น request แยก ห้ามทำในคำขอนี้เพราะ Omise จะ timeout แล้ว retry

  return { handled: true, changed: changed, order_ref: order.order_ref, status: next };
}

module.exports = { applyChargeResult };
