/* ============================================================
   Token เซ็นด้วย HMAC-SHA256 แบบ stateless — ไม่ต้องพึ่ง DB/cookie/
   sessionStorage ในการตรวจสอบว่า "ของจริง ยังไม่หมดอายุ ไม่ถูกแก้ไข"
   เลย เพราะฝัง payload + ลายเซ็นไว้ในตัว token เอง verify ได้จากค่า
   secret ฝั่ง server เท่านั้น

   ใช้ 2 ที่ในโปรเจกต์นี้:
   1. OAuth state ของ LINE Login — แก้ปัญหา state หายตอนแอป LINE เปิด
      redirect กลับมาในเบราว์เซอร์คนละ context (sessionStorage ตามไม่ทัน)
   2. connect_token ที่ฝังในอีเมลยืนยันคำสั่งซื้อ ให้ลูกค้าผูกบัญชี LINE
      กับอีเมลที่ซื้อไว้ได้โดยไม่ต้องพิมพ์อีเมลเอง

   ทุก payload ต้องมี field `p` (purpose) กันเอา token ประเภทหนึ่งไป
   สวมรอยใช้อีกประเภทได้ ผู้เรียกต้องเช็ค payload.p เองหลัง verify()
   ============================================================ */

'use strict';

const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return body + '.' + sig;
}

/** คืน payload ที่ decode แล้วถ้า token ถูกต้อง+ยังไม่หมดอายุ ไม่งั้นคืน null */
function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

module.exports = { sign, verify };
