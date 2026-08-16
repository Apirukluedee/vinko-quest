/* ============================================================
   GET /api/download-info?token=...
   ข้อมูลที่หน้า /download ต้องใช้แสดงรายการไฟล์

   คืนเฉพาะสิ่งที่เจ้าของ token รู้อยู่แล้ว
   ไม่คืนอีเมล เบอร์โทร หรือยอดเงิน
   ============================================================ */
'use strict';

const tokens = require('./_lib/tokens');
const { json, fail, requireEnv } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');
  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  const url = new URL(req.url, 'http://localhost');
  const t = await tokens.resolve(url.searchParams.get('token') || '');

  if (!t.ok) {
    const msg = {
      invalid:   'ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบลิงก์จากอีเมลอีกครั้ง',
      not_found: 'ไม่พบลิงก์นี้ อาจถูกยกเลิกไปแล้ว',
      not_paid:  'คำสั่งซื้อนี้ยังไม่เสร็จสมบูรณ์',
      expired:   'ลิงก์หมดอายุแล้ว กดขอลิงก์ใหม่ได้ด้านล่าง'
    }[t.reason] || 'ลิงก์ใช้งานไม่ได้';
    return json(res, t.reason === 'expired' ? 410 : 404,
                { ok: false, reason: t.reason, error: msg });
  }

  const order = t.order;
  const items = await tokens.itemsFor(order.id);
  const now = Date.now();

  const out = [];
  for (const it of items) {
    const released = tokens.isReleased(it, now);
    const used = released ? await tokens.downloadCount(it.id) : 0;
    out.push({
      id: it.id,
      title: it.title,
      delivery_type: it.delivery_type,
      scheduled_delivery_date: it.scheduled_delivery_date,
      released: released,
      downloads_used: used,
      downloads_left: Math.max(0, tokens.MAX_DOWNLOADS_PER_ITEM - used)
    });
  }

  return json(res, 200, {
    ok: true,
    order_ref: order.order_ref,
    customer_name: order.customer_name || '',
    package_code: order.package_code,
    expires_at: order.token_expires_at,
    max_downloads: tokens.MAX_DOWNLOADS_PER_ITEM,
    items: out
  });
};
