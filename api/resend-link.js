/* ============================================================
   POST /api/resend-link

   Path A — { token }
     ส่งลิงก์ใหม่ผ่าน token เก่าที่หมดอายุ (ปุ่มใน /download)
     ส่งไปที่อีเมลเดิมของออเดอร์เท่านั้น ไม่รับอีเมลจากผู้ใช้

   Path B — { order_ref, email }
     ลูกค้ากรอกเลขที่คำสั่งซื้อ + อีเมล (จากเมนู LINE หรือหน้า /resend-link)
     ตอบ generic OK เสมอ ไม่ว่าจะเจอออเดอร์หรือไม่ ป้องกัน enumeration
   ============================================================ */
'use strict';

const db     = require('./_lib/supabase');
const tokens = require('./_lib/tokens');
const email  = require('./_lib/email');
const { json, fail, hashIp, requireEnv } = require('./_lib/util');

const GENERIC_MSG = 'ถ้าเลขที่คำสั่งซื้อและอีเมลตรงกัน เราส่งลิงก์ไปที่อีเมลนั้นแล้ว ' +
                    'กรุณาตรวจกล่องจดหมาย และโฟลเดอร์ junk ด้วยนะครับ';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');
  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  hashIp(req);   // ให้แน่ใจว่ามี salt ตั้งไว้ (จะโยน error ตั้งแต่ตอน deploy ถ้าลืม)

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = body && typeof body.token === 'string' ? body.token : '';

  /* ─── Path B: order_ref + email ───────────────────────────── */
  if (!token) {
    const ref        = body && typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
    const givenEmail = body && typeof body.email     === 'string' ? body.email.trim().toLowerCase() : '';

    if (!/^VK-\d{4}-\d{4,6}$/.test(ref) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(givenEmail)) {
      return fail(res, 400, 'กรุณากรอกเลขที่คำสั่งซื้อและอีเมลให้ถูกต้อง');
    }

    const r2 = await db.select('orders',
      'order_ref=eq.' + encodeURIComponent(ref) +
      '&select=id,order_ref,status,customer_email&limit=1');
    const order2 = Array.isArray(r2.body) && r2.body[0];

    // ไม่เจอออเดอร์ หรืออีเมลไม่ตรง → generic OK ป้องกันการแจงว่า order_ref ใดมีจริง
    if (!order2 || order2.status !== 'paid' ||
        (order2.customer_email || '').toLowerCase() !== givenEmail) {
      return json(res, 200, { ok: true, message: GENERIC_MSG });
    }

    const since2 = new Date(Date.now() - 10 * 60000).toISOString();
    const recent2 = await db.count('email_events',
      'order_id=eq.' + order2.id + '&kind=eq.resend_link&created_at=gte.' + encodeURIComponent(since2));
    if (recent2 >= 3) {
      return fail(res, 429, 'ขอลิงก์ใหม่ถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง');
    }

    const newToken2 = await tokens.issue(order2.id);
    const fresh2 = await db.select('orders', 'id=eq.' + order2.id + '&select=token_expires_at&limit=1');
    const expiresAt2 = (Array.isArray(fresh2.body) && fresh2.body[0] && fresh2.body[0].token_expires_at) ||
                       tokens.expiryFromNow();

    const payload2 = email.resendEmail({ orderRef: order2.order_ref, token: newToken2, expiresAt: expiresAt2 });
    await email.send('resend_link', order2.customer_email, payload2, { orderId: order2.id })
               .catch(function (e) { console.error('[vinko][resend-b]', e.message); });

    return json(res, 200, { ok: true, message: GENERIC_MSG });
  }

  /* ─── Path A: token ────────────────────────────────────────── */
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

  const payload = email.resendEmail({ orderRef: order.order_ref, token: newToken, expiresAt: expiresAt });
  const out = await email.send('resend_link', order.customer_email, payload, { orderId: order.id });

  if (!out.ok) return fail(res, 502, 'ส่งอีเมลไม่สำเร็จ กรุณาติดต่อเราทาง LINE', out.error);
  return json(res, 200, { ok: true, message: 'ส่งลิงก์ใหม่ไปที่อีเมลเดิมของคุณแล้ว' });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
