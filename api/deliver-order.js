/* ============================================================
   POST /api/deliver-order   (ภายในเท่านั้น)

   ออก download token แล้วส่งอีเมลยืนยันการสั่งซื้อ

   แยกออกมาจาก webhook เพื่อให้ webhook ตอบ 200 ได้เร็ว
   ถ้าตอบช้า Omise จะ retry แล้วจะยุ่ง

   ป้องกันด้วย INTERNAL_TASK_SECRET — endpoint นี้ห้ามให้คนนอกเรียกได้
   ============================================================ */

'use strict';

const db      = require('./_lib/supabase');
const tokens  = require('./_lib/tokens');
const email   = require('./_lib/email');
const catalog = require('./_lib/catalog');
const { json, safeEqual } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  const secret = process.env.INTERNAL_TASK_SECRET;
  const given = req.headers['x-vinko-task'];
  if (!secret || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const orderRef = body && typeof body.order_ref === 'string' ? body.order_ref : null;
  if (!orderRef) return json(res, 400, { ok: false, error: 'ไม่มี order_ref' });

  try {
    const result = await deliver(orderRef);
    return json(res, 200, result);
  } catch (e) {
    console.error('[vinko][deliver]', orderRef, e.message);
    // ลูกค้าจ่ายเงินแล้ว ห้ามให้ออเดอร์กลายเป็น failed เพราะอีเมลส่งไม่ออก
    return json(res, 500, { ok: false, error: 'ส่งมอบไม่สำเร็จ' });
  }
};

/** ใช้ร่วมกับ /api/admin/resend-email ได้ */
async function deliver(orderRef, opts) {
  const force = opts && opts.force;

  const r = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) +
    '&select=id,order_ref,status,package_code,customer_name,customer_email,' +
    'download_token,token_expires_at&limit=1');
  const order = Array.isArray(r.body) && r.body[0];
  if (!order) return { ok: false, error: 'ไม่พบคำสั่งซื้อ' };
  if (order.status !== 'paid') return { ok: false, error: 'คำสั่งซื้อยังไม่อยู่ในสถานะ paid' };

  // เคยส่งไปแล้วและ token ยังไม่หมดอายุ ไม่ต้องส่งซ้ำ (webhook อาจถูกยิงซ้ำ)
  const stillValid = order.download_token && order.token_expires_at &&
                     new Date(order.token_expires_at).getTime() > Date.now();
  if (stillValid && !force) {
    const sent = await db.count('email_events',
      'order_id=eq.' + order.id + '&kind=eq.purchase&status=eq.sent');
    if (sent > 0) return { ok: true, skipped: 'ส่งอีเมลไปแล้ว' };
  }

  const token = stillValid && !force
    ? order.download_token
    : await tokens.issue(order.id);

  const fresh = await db.select('orders',
    'id=eq.' + order.id + '&select=token_expires_at&limit=1');
  const expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                    tokens.expiryFromNow();

  const items = await tokens.itemsFor(order.id);
  const pkg = catalog.getPackage(order.package_code);

  const payload = email.purchaseEmail({
    orderRef: order.order_ref,
    packageCode: order.package_code,
    packageTitle: (pkg && pkg.title) || order.package_code,
    token: token,
    expiresAt: expiresAt,
    items: items
  });

  const out = await email.send('purchase', order.customer_email, payload, { orderId: order.id });
  return { ok: true, emailed: out.ok, message_id: out.id || null, error: out.error || null };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

module.exports.deliver = deliver;
