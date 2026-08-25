/* ============================================================
   POST /api/admin   { action, ... }
   header: x-vinko-admin: <ADMIN_SECRET>

   เครื่องมือของแอดมินทั้งหมดรวมไว้ที่ไฟล์เดียว

   ที่ต้องรวมเพราะ Vercel Hobby จำกัด serverless function ไว้ 12 ตัว
   ต่อ deployment ถ้าแยกไฟล์ละ endpoint จะเต็มโควตาแล้ว deploy ล้มทั้งชุด
   เพิ่ม action ใหม่ที่นี่ได้เรื่อยๆ โดยไม่กินโควตาเพิ่ม

   action ที่รองรับ:
     resend-email   { order_ref }                     ออก token ใหม่แล้วส่งอีเมลซ้ำ
     test-line                                       ยิงข้อความทดสอบเข้า LINE ของแอดมิน
     refund-status  { order_ref }                    ดูสถานะคืนเงิน เทียบ DB กับ Omise
     refund         { order_ref, scope, note }       บันทึกการคืนเงินและตัดสิทธิ์โหลด

   หมายเหตุ: action refund ไม่ได้สั่งคืนเงินเอง เจ้าของต้องกดคืนที่แดชบอร์ด
   Omise ก่อน แล้วตัวนี้จะไปยืนยันกับ Omise ว่าคืนจริงถึงจะยอมตัดสิทธิ์
   ============================================================ */
'use strict';

const { deliver } = require('./deliver-order');
const line = require('./_lib/line');
const refunds = require('./_lib/refunds');
const { json, safeEqual } = require('./_lib/util');
const config = require('./_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  const secret = config.adminSecret();
  const given = req.headers['x-vinko-admin'];
  if (!secret || secret.length < 16 || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false, error: 'ไม่ได้รับอนุญาต' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const action = body && typeof body.action === 'string' ? body.action.trim() : '';

  try {
    if (action === 'test-line') {
      const out = await line.notifyTest();
      return json(res, out.ok ? 200 : 400, out);
    }

    if (action === 'resend-email') {
      const ref = typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
      if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) {
        return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });
      }
      // force = ออก token ใหม่และส่งอีเมลซ้ำเสมอ แม้เคยส่งไปแล้ว
      const out = await deliver(ref, { force: true });
      return json(res, out.ok ? 200 : 400, out);
    }

    if (action === 'refund-status' || action === 'refund') {
      const ref = typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
      if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) {
        return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });
      }

      if (action === 'refund-status') {
        const out = await refunds.status(ref);
        return json(res, out.ok ? 200 : 404, out);
      }

      const scope = body.scope === 'preorder' ? 'preorder' : 'full';
      const out = await refunds.record(ref, { scope: scope, note: body.note });
      if (out.ok && !out.already) {
        // แจ้ง LINE ไว้เป็นหลักฐานว่าตัดสิทธิ์เมื่อไหร่ ออเดอร์ไหน
        // แจ้งไม่สำเร็จก็ไม่ถือว่าล้มเหลว การคืนเงินบันทึกลง DB ไปแล้ว
        await line.notifyRefund(out.order_ref, scope, out.refund_satang)
          .catch(function (e) {
            console.error('[vinko][admin] แจ้ง LINE เรื่องคืนเงินไม่สำเร็จ', e.message);
          });
      }
      return json(res, out.ok ? 200 : 400, out);
    }

    return json(res, 400, { ok: false, error: 'ไม่รู้จัก action นี้' });
  } catch (e) {
    console.error('[vinko][admin]', action, e.message);
    return json(res, 500, { ok: false, error: 'ทำรายการไม่สำเร็จ' });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
