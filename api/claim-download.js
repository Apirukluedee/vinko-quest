/* ============================================================
   POST /api/claim-download   { order_ref, client_request_id }

   ให้หน้า /thank-you แสดงลิงก์ดาวน์โหลดได้ทันทีโดยไม่ต้องรออีเมล
   (อีเมลอาจช้าหรือเข้า junk ลูกค้าที่จ่ายเงินแล้วไม่ได้ของทันที
    คือลูกค้าที่กำลังจะทักมาถาม)

   ความปลอดภัย: order_ref เดาได้ แต่ client_request_id เป็นค่าสุ่ม
   ที่เบราว์เซอร์ของผู้ซื้อสร้างตอนกดจ่ายเงิน คนอื่นไม่มีทางรู้
   จึงต้องตรงกันทั้งคู่ถึงจะคืน token ให้
   ============================================================ */
'use strict';

const db = require('./_lib/supabase');
const tokens = require('./_lib/tokens');
const { json, fail, requireEnv, safeEqual } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');
  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const ref = body && typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
  const rid = body && typeof body.client_request_id === 'string' ? body.client_request_id.trim() : '';

  if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) return fail(res, 400, 'เลขที่คำสั่งซื้อไม่ถูกต้อง');
  if (rid.length < 16 || rid.length > 64) return fail(res, 400, 'ข้อมูลยืนยันไม่ถูกต้อง');

  const r = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(ref) +
    '&select=order_ref,status,client_request_id,download_token,token_expires_at&limit=1');
  const order = Array.isArray(r.body) && r.body[0];

  if (!order || !order.client_request_id || !safeEqual(order.client_request_id, rid)) {
    return fail(res, 403, 'ไม่สามารถยืนยันคำสั่งซื้อนี้ได้ กรุณาใช้ลิงก์จากอีเมลแทน');
  }
  if (order.status !== 'paid') {
    return json(res, 200, { ok: true, status: order.status, ready: false });
  }

  /* จ่ายแล้วแต่ยังไม่มี token = webhook ออกให้ไม่สำเร็จ
     ออกให้เดี๋ยวนี้เลย ไม่ปล่อยให้ลูกค้าที่จ่ายเงินแล้วรอเก้อ
     ปลอดภัยเพราะผ่านด่าน client_request_id กับ status=paid มาแล้วทั้งคู่ */
  let token = order.download_token;
  let expiresAt = order.token_expires_at;
  if (!token) {
    try {
      token = await tokens.issue(order.id);
      const fresh = await db.select('orders',
        'id=eq.' + order.id + '&select=token_expires_at&limit=1');
      expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                  tokens.expiryFromNow();
      console.warn('[vinko][claim] ออก token ย้อนหลังให้', order.order_ref, '— webhook ทำไม่สำเร็จ');
    } catch (e) {
      console.error('[vinko][claim] ออก token ไม่สำเร็จ', order.order_ref, e.message);
      return json(res, 200, { ok: true, status: 'paid', ready: false });
    }
  }

  return json(res, 200, {
    ok: true, status: 'paid', ready: true,
    download_url: '/download?token=' + encodeURIComponent(token),
    expires_at: expiresAt
  });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
