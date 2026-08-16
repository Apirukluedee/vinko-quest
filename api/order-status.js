/* ============================================================
   GET /api/order-status?ref=VK-2609-0001

   หน้า checkout เรียกตัวนี้ทุก 3 วินาทีระหว่างรอลูกค้าสแกน PromptPay

   คืนแค่ order_ref กับ status เท่านั้น
   ห้ามคืนชื่อ อีเมล เบอร์โทร หรือยอดเงิน
   เพราะ ref เดาได้ (VK-2609-0001, 0002, ...) ใครก็ยิงมาถามได้
   ============================================================ */

'use strict';

const db = require('./_lib/supabase');
const { json, fail, requireEnv } = require('./_lib/util');

const REF_RE = /^VK-\d{4}-\d{4,6}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');

  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  const url = new URL(req.url, 'http://localhost');
  const ref = (url.searchParams.get('ref') || '').trim();

  if (!REF_RE.test(ref)) return fail(res, 400, 'เลขที่ออเดอร์ไม่ถูกต้อง');

  const r = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(ref) + '&select=order_ref,status&limit=1');

  const row = Array.isArray(r.body) && r.body[0];
  if (!row) return fail(res, 404, 'ไม่พบคำสั่งซื้อนี้');

  return json(res, 200, { ok: true, order_ref: row.order_ref, status: row.status });
};
