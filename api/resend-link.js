/* ============================================================
   POST /api/resend-link   { token }

   ส่งลิงก์ใหม่ไปที่ "อีเมลเดิมของออเดอร์นั้น" เท่านั้น
   ไม่รับอีเมลจากผู้ใช้เด็ดขาด ไม่งั้นกลายเป็นช่องทางขโมยไฟล์
   ============================================================ */
'use strict';

const db     = require('./_lib/supabase');
const tokens = require('./_lib/tokens');
const email  = require('./_lib/email');
const { json, fail, hashIp, requireEnv } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');
  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = body && typeof body.token === 'string' ? body.token : '';

  // token ที่หมดอายุยังต้องขอลิงก์ใหม่ได้ จึงหาออเดอร์ตรงๆ ไม่ใช้ resolve()
  if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return fail(res, 400, 'ลิงก์ไม่ถูกต้อง');
  }

  const r = await db.select('orders',
    'download_token=eq.' + encodeURIComponent(token) +
    '&select=id,order_ref,status,customer_email,download_token&limit=1');
  const order = Array.isArray(r.body) && r.body[0];
  if (!order || order.status !== 'paid') return fail(res, 404, 'ไม่พบคำสั่งซื้อนี้');

  // กันกดรัวจนอีเมลท่วม
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const recent = await db.count('email_events',
    'order_id=eq.' + order.id + '&kind=eq.resend_link&created_at=gte.' + encodeURIComponent(since));
  if (recent >= 3) {
    return fail(res, 429, 'ขอลิงก์ใหม่ถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง');
  }

  const newToken = await tokens.issue(order.id);
  const fresh = await db.select('orders', 'id=eq.' + order.id + '&select=token_expires_at&limit=1');
  const expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                    tokens.expiryFromNow();

  const payload = email.resendEmail({
    orderRef: order.order_ref, token: newToken, expiresAt: expiresAt
  });
  const out = await email.send('resend_link', order.customer_email, payload, { orderId: order.id });

  hashIp(req);   // ให้แน่ใจว่ามี salt ตั้งไว้ (จะโยน error ตั้งแต่ตอน deploy ถ้าลืม)

  if (!out.ok) return fail(res, 502, 'ส่งอีเมลไม่สำเร็จ กรุณาติดต่อเราทาง LINE', out.error);
  return json(res, 200, { ok: true, message: 'ส่งลิงก์ใหม่ไปที่อีเมลเดิมของคุณแล้ว' });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
