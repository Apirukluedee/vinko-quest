/* ============================================================
   แจ้งเตือนออเดอร์ใหม่ทาง LINE (Messaging API — push message)

   ไม่บังคับ: ถ้าไม่ตั้ง LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_ADMIN_USER_ID
   จะข้ามเงียบๆ ไม่ throw เพราะการแจ้งเตือนพัง ต้องไม่ทำให้ออเดอร์ลูกค้าพังตาม

   เรียกแบบ fire-and-forget จาก omise-webhook.js เหมือน triggerDelivery
   ============================================================ */

'use strict';

const db      = require('./supabase');
const catalog = require('./catalog');
const config  = require('./config');

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function formatBaht(satang) {
  return (Number(satang) / 100).toLocaleString('th-TH', { minimumFractionDigits: 0 });
}

/** ส่งข้อความดิบไปหาแอดมิน — ปลายทางมาจาก env เท่านั้น ไม่รับจากผู้เรียก */
async function pushToAdmin(text) {
  const token = config.lineChannelToken();
  const userId = config.lineAdminUserId();
  if (!token || !userId) return { ok: false, skipped: 'LINE_NOT_CONFIGURED' };

  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] })
  });

  if (!res.ok) {
    const body = await res.text().catch(function () { return ''; });
    return { ok: false, error: 'LINE_API_' + res.status + ': ' + body.slice(0, 200) };
  }
  return { ok: true };
}

/** ข้อความทดสอบ ใช้ยืนยันว่าตั้งค่าถูกโดยไม่ต้องรอออเดอร์จริง */
async function notifyTest() {
  try {
    return await pushToAdmin(
      '✅ ทดสอบการแจ้งเตือน VINKO\n' +
      'ถ้าเห็นข้อความนี้ แปลว่าตั้งค่าถูกต้องแล้ว\n' +
      'ออเดอร์จริงจะแจ้งเตือนแบบนี้ทุกครั้ง'
    );
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** ส่งข้อความแจ้งเตือนออเดอร์เดียว — คืน { ok, skipped? , error? } เสมอ ไม่ throw */
async function notifyOrder(orderRef) {
  if (!config.lineChannelToken() || !config.lineAdminUserId()) {
    return { ok: false, skipped: 'LINE_NOT_CONFIGURED' };
  }

  try {
    const r = await db.select('orders',
      'order_ref=eq.' + encodeURIComponent(orderRef) +
      '&select=order_ref,package_code,customer_name,customer_email,amount_satang,currency&limit=1');
    const order = Array.isArray(r.body) && r.body[0];
    if (!order) return { ok: false, error: 'order_not_found' };

    const pkg = catalog.getPackage(order.package_code);
    const title = (pkg && pkg.title) || order.package_code;

    const text =
      '🔔 ออเดอร์ใหม่ · VINKO\n' +
      title + '\n' +
      '฿' + formatBaht(order.amount_satang) + '\n' +
      (order.customer_name || '-') + '\n' +
      (order.customer_email || '-') + '\n' +
      'อ้างอิง: ' + order.order_ref;

    return await pushToAdmin(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { notifyOrder, notifyTest };
