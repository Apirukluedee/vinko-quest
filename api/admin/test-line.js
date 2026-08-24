/* ============================================================
   POST /api/admin/test-line
   header: x-vinko-admin: <ADMIN_SECRET>

   ยิงข้อความทดสอบเข้า LINE ของแอดมิน

   มีไว้เพื่อตอบคำถาม "ตั้งค่าถูกแล้วจริงไหม" โดยไม่ต้องรอออเดอร์จริง
   ถ้าไม่มีทางทดสอบ จะไปรู้ว่าพังตอนมีออเดอร์แรกพอดี ซึ่งสายเกินไป

   ส่งได้เฉพาะหา LINE_ADMIN_USER_ID เท่านั้น รับพารามิเตอร์ปลายทางไม่ได้
   จะได้ไม่กลายเป็นช่องส่งข้อความมั่วในนามบัญชีเรา
   ============================================================ */
'use strict';

const line = require('../_lib/line');
const { json, safeEqual } = require('../_lib/util');
const config = require('../_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  const secret = config.adminSecret();
  const given = req.headers['x-vinko-admin'];
  if (!secret || secret.length < 16 || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false, error: 'ไม่ได้รับอนุญาต' });
  }

  const out = await line.notifyTest();
  return json(res, out.ok ? 200 : 400, out);
};
