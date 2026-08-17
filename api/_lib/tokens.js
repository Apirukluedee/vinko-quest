/* ============================================================
   token ของหน้าดาวน์โหลด

   ใช้ crypto.randomBytes ไม่ใช่ uuid — uuid v4 อ่านรูปแบบออกและ
   บาง implementation เดาลำดับได้ ส่วนนี้คือกุญแจเข้าถึงสินค้าที่จ่ายเงินแล้ว
   ============================================================ */

'use strict';

const crypto = require('crypto');
const db = require('./supabase');

const TTL_HOURS = 48;
const MAX_DOWNLOADS_PER_ITEM = 10;   // เผื่อโหลดพลาด เปลี่ยนเครื่อง แต่กันเอาลิงก์ไปโพสต์ในกลุ่ม

/** 43 ตัวอักษรจาก 32 ไบต์สุ่ม */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function expiryFromNow(hours) {
  return new Date(Date.now() + (hours || TTL_HOURS) * 3600 * 1000).toISOString();
}

/** ออก token ใหม่ให้ออเดอร์ (ใช้ตอนจ่ายเงินสำเร็จ) */
async function issue(orderId, hours) {
  const token = newToken();
  const r = await db.update('orders', 'id=eq.' + orderId, {
    download_token: token,
    token_expires_at: expiryFromNow(hours)
  });
  if (!r.ok) throw new Error('ออก token ไม่สำเร็จ: ' + JSON.stringify(r.body));
  return token;
}

/** ต่ออายุ token เดิม ถ้ายังไม่มีให้ออกใหม่ (ใช้ตอนขอลิงก์ใหม่ / ถึงกำหนดส่งนิทาน) */
async function renew(order, hours) {
  if (order.download_token) {
    const r = await db.update('orders', 'id=eq.' + order.id, {
      token_expires_at: expiryFromNow(hours)
    });
    if (!r.ok) throw new Error('ต่ออายุ token ไม่สำเร็จ');
    return order.download_token;
  }
  return issue(order.id, hours);
}

/**
 * แลก token เป็นออเดอร์ พร้อมตรวจให้ครบทุกเงื่อนไข
 * @returns {Promise<{ok:boolean, reason?:string, order?:object}>}
 */
async function resolve(token) {
  if (typeof token !== 'string' || token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: 'invalid' };
  }

  const r = await db.select(
    'orders',
    'download_token=eq.' + encodeURIComponent(token) +
    '&select=id,order_ref,status,package_code,customer_name,customer_email,' +
    'download_token,token_expires_at,paid_at&limit=1'
  );
  const order = Array.isArray(r.body) && r.body[0];
  if (!order) return { ok: false, reason: 'not_found' };
  if (order.status !== 'paid') return { ok: false, reason: 'not_paid', order: order };

  const exp = order.token_expires_at ? new Date(order.token_expires_at).getTime() : 0;
  if (!exp || Date.now() > exp) return { ok: false, reason: 'expired', order: order };

  return { ok: true, order: order };
}

/** รายการไฟล์ของออเดอร์ พร้อมบอกว่าโหลดได้แล้วหรือยัง */
async function itemsFor(orderId) {
  const r = await db.select(
    'order_items',
    'order_id=eq.' + orderId +
    '&select=id,product_code,title,delivery_type,scheduled_delivery_date,delivered_at' +
    '&order=delivery_type.asc,product_code.asc'
  );
  return Array.isArray(r.body) ? r.body : [];
}

/** ถึงกำหนดส่งแล้วหรือยัง */
function isReleased(item, now) {
  if (item.delivery_type === 'instant') return true;
  if (!item.scheduled_delivery_date) return false;
  const due = new Date(item.scheduled_delivery_date + 'T00:00:00+07:00').getTime();
  return (now || Date.now()) >= due;
}

/** โหลดไฟล์นี้ไปกี่ครั้งแล้ว */
async function downloadCount(orderItemId) {
  try {
    return await db.count('download_events',
      'order_item_id=eq.' + encodeURIComponent(orderItemId));
  } catch (e) {
    console.error('[vinko] นับจำนวนดาวน์โหลดไม่สำเร็จ', e.message);
    return 0;   // นับไม่ได้ก็ไม่บล็อกลูกค้าที่จ่ายเงินแล้ว
  }
}

module.exports = {
  TTL_HOURS, MAX_DOWNLOADS_PER_ITEM,
  newToken, issue, renew, resolve, itemsFor, isReleased, downloadCount, expiryFromNow
};
