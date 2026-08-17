/* ============================================================
   GET /api/download?token=...&item=...

   ส่งไฟล์จริง โดยใส่ลายน้ำสดทุกครั้งที่โหลด
   ไม่มีไฟล์ที่ใส่ลายน้ำแล้วถูกเก็บไว้ที่ไหนเลย

   URL ของ Supabase Storage ไม่เคยหลุดถึง browser
   ทุกไบต์วิ่งผ่าน endpoint นี้
   ============================================================ */

'use strict';

const db      = require('./_lib/supabase');
const tokens  = require('./_lib/tokens');
const storage = require('./_lib/storage');
const wm      = require('./_lib/watermark');
const { fail, hashIp, requireEnv } = require('./_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');

  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const itemId = url.searchParams.get('item') || '';

  /* ---------- 1. ตรวจ token ---------- */
  const t = await tokens.resolve(token);
  if (!t.ok) {
    const msg = {
      invalid:   'ลิงก์ไม่ถูกต้อง',
      not_found: 'ไม่พบลิงก์นี้',
      not_paid:  'คำสั่งซื้อนี้ยังไม่เสร็จสมบูรณ์',
      expired:   'ลิงก์หมดอายุแล้ว กรุณากดขอลิงก์ใหม่ที่หน้าดาวน์โหลด'
    }[t.reason] || 'ลิงก์ใช้งานไม่ได้';
    return fail(res, t.reason === 'expired' ? 410 : 403, msg);
  }
  const order = t.order;

  /* ---------- 2. ไฟล์นี้เป็นของออเดอร์นี้จริงและถึงกำหนดแล้ว ---------- */
  const items = await tokens.itemsFor(order.id);
  const item = items.find(function (i) { return i.id === itemId; });
  if (!item) return fail(res, 404, 'ไม่พบไฟล์นี้ในคำสั่งซื้อของคุณ');

  if (!tokens.isReleased(item)) {
    return fail(res, 403, 'ไฟล์นี้ยังไม่ถึงกำหนดส่ง เราจะส่งอีเมลแจ้งคุณเมื่อพร้อมดาวน์โหลด');
  }

  /* ---------- 3. จำกัดจำนวนครั้ง ---------- */
  const used = await tokens.downloadCount(item.id);
  if (used >= tokens.MAX_DOWNLOADS_PER_ITEM) {
    return fail(res, 429,
      'ไฟล์นี้ถูกดาวน์โหลดครบ ' + tokens.MAX_DOWNLOADS_PER_ITEM + ' ครั้งแล้ว ' +
      'ถ้ายังต้องการไฟล์ ทักหาเราทาง LINE ได้เลย เราออกให้ใหม่ให้ครับ');
  }

  /* ---------- 4. ดึงต้นฉบับ + ใส่ลายน้ำสด ---------- */
  let stamped;
  try {
    const master = await storage.download(item.product_code);
    if (!master) {
      console.error('[vinko][download] ไม่พบไฟล์ต้นฉบับใน storage:', item.product_code);
      return fail(res, 503, 'ไฟล์ยังไม่พร้อมให้ดาวน์โหลด กรุณาติดต่อเราทาง LINE');
    }
    stamped = await wm.stamp(master, {
      orderRef: order.order_ref,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      title: item.title
    });
  } catch (e) {
    console.error('[vinko][download] ใส่ลายน้ำไม่สำเร็จ', order.order_ref, item.product_code, e.message);
    return fail(res, 500, 'เตรียมไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }

  /* ---------- 5. บันทึก log ---------- */
  // เก็บ IP เป็น hash ไม่เก็บ IP ดิบ (PDPA)
  try {
    await db.insert('download_events', {
      order_id: order.id,
      order_item_id: item.id,
      ip_hash: hashIp(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300)
    });
  } catch (e) {
    console.error('[vinko][download] บันทึก log ไม่สำเร็จ', e.message);  // ไม่บล็อกลูกค้า
  }

  /* ---------- 6. ส่งไฟล์ ---------- */
  const filename = wm.safeFilename(item.title, order.order_ref);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', wm.contentDisposition(filename));
  res.setHeader('Content-Length', String(stamped.bytes.length));
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(Buffer.from(stamped.bytes));
};
