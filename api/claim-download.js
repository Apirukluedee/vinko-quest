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
  if (!order.download_token) {
    // webhook ยังทำงานไม่เสร็จ ให้ฝั่งหน้าเว็บลองใหม่อีกครู่
    return json(res, 200, { ok: true, status: 'paid', ready: false });
  }

  return json(res, 200, {
    ok: true, status: 'paid', ready: true,
    download_url: '/download?token=' + encodeURIComponent(order.download_token),
    expires_at: order.token_expires_at
  });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
