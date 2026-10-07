'use strict';

const crypto = require('crypto');
const db     = require('./supabase');

/* จำการเข้าสู่ระบบไว้ 1 ปี (เดิม 30 วัน)
   ลูกค้าเปิดหนังสือจากเมนู LINE เป็นระยะๆ 30 วันทำให้หลุดบ่อยจนนึกว่าระบบเสีย
   ของที่ปกป้องคือ ebook ที่มีลายน้ำผู้ซื้อ ไม่ใช่เงินหรือข้อมูลอ่อนไหว
   และมีปุ่มออกจากระบบให้กดเองได้
   ใส่ expires_at เองทุกครั้งที่สร้างแถว ไม่พึ่งค่า default ของฐานข้อมูล
   (session เดิมที่สร้างไปแล้วยังหมดอายุตามค่าเดิม) */
const SESSION_DAYS = 365;
function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* สร้าง session พร้อม magic token สำหรับ email login
   line_user_id (ใส่มาเมื่อมาจากหน้า "need_email" หลัง LINE login ไม่ได้
   อีเมล) ถูกเก็บไว้ในแถวนี้ด้วย เพื่อให้ครั้งถัดไป LINE login ตรงๆ (ไม่มี
   อีเมลจาก LINE อีก) หา email เดิมเจอได้เอง ไม่ต้องให้กรอกซ้ำทุกครั้ง —
   ดู findEmailByLineUserId */
async function createMagicSession(email, line_user_id) {
  const magic_token      = genToken();
  const magic_expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const row = { email, magic_token, magic_expires_at, expires_at: sessionExpiresAt() };
  if (line_user_id) row.line_user_id = line_user_id;

  const r = await db.insert('user_sessions', row);
  if (!r.ok) throw new Error('session_create_failed: ' + JSON.stringify(r.body));
  return { magic_token };
}

/* หา email ที่เคยผูกกับ LINE user id นี้ไว้แล้ว (จาก session ก่อนหน้า
   ไม่ว่าจะสร้างผ่าน magic link ที่แนบ line_uid มา หรือผ่าน createLineSession
   ตรงๆ) คืน email ล่าสุดถ้าเจอ ไม่งั้นคืน null */
async function findEmailByLineUserId(line_user_id) {
  if (!line_user_id) return null;
  const r = await db.select('user_sessions',
    'line_user_id=eq.' + encodeURIComponent(line_user_id) +
    '&email=not.is.null&select=email&order=created_at.desc&limit=1'
  );
  if (!r.ok || !Array.isArray(r.body) || !r.body[0]) return null;
  return r.body[0].email;
}

/* ตรวจ magic token → คืน {email, session_token} หรือ null
   ใช้ atomic UPDATE (ไม่ใช่ SELECT แล้วค่อย UPDATE) เพื่อกัน TOCTOU race:
   สอง request ที่มาพร้อมกันจะผ่านเงื่อนไขเดียวกันพร้อมกันไม่ได้
   เพราะ DB จะให้แก้ไขแถวเดียวกันได้แค่ครั้งเดียวใน transaction */
async function activateMagicSession(magic_token) {
  if (!magic_token) return null;

  const now = new Date().toISOString();
  const r = await db.update(
    'user_sessions',
    'magic_token=eq.' + encodeURIComponent(magic_token) +
    '&magic_expires_at=gt.' + encodeURIComponent(now),
    { magic_token: null, magic_expires_at: null }
  );
  if (!r.ok || !Array.isArray(r.body) || !r.body[0]) return null;
  const { email, session_token } = r.body[0];
  if (!email) return null;
  return { email, session_token };
}

/* สร้าง session จาก LINE login */
async function createLineSession(email, line_user_id) {
  const r = await db.insert('user_sessions', { email, line_user_id, expires_at: sessionExpiresAt() });
  if (!r.ok) throw new Error('session_create_failed');
  const s = Array.isArray(r.body) ? r.body[0] : r.body;
  return { session_token: s.session_token };
}

/* LINE ที่ผูกกับอีเมลนี้แล้วทั้งหมด (ไม่ซ้ำ) — ทุกช่องทาง:
   ลิงก์/QR ผูก LINE, LINE ที่แชร์อีเมลนี้มาเอง, และผูกผ่านลิงก์ในอีเมล (need_email)
   รวม session ที่หมดอายุแล้วด้วย เพราะ LINE นั้นยังถือว่าผูกอยู่
   ใช้นับเพดานจำนวน LINE ต่ออีเมล — อ่านไม่ได้ให้ throw (ผู้เรียกตัดสินเอง) */
async function lineUserIdsForEmail(email) {
  const r = await db.select('user_sessions',
    'email=eq.' + encodeURIComponent(String(email || '').toLowerCase()) +
    '&line_user_id=not.is.null&select=line_user_id&limit=5000'
  );
  if (!r.ok || !Array.isArray(r.body)) throw new Error('line_ids_lookup_failed: ' + r.status);
  return Array.from(new Set(r.body.map(function (x) { return x.line_user_id; }).filter(Boolean)));
}

/* ตรวจ session cookie → คืน {id, email} หรือ null */
async function validateSession(session_token) {
  if (!session_token) return null;

  const r = await db.select('user_sessions',
    'session_token=eq.' + encodeURIComponent(session_token) +
    '&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) +
    '&select=id,email&limit=1'
  );
  if (!r.ok || !Array.isArray(r.body) || !r.body[0]) return null;
  return r.body[0];
}

/* อ่าน session token จาก cookie header */
function getSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)vnk_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* สร้าง Set-Cookie header */
function cookieHeader(token, clear) {
  if (clear) return 'vnk_sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  const maxAge = SESSION_DAYS * 24 * 3600;
  return `vnk_sid=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

module.exports = {
  createMagicSession,
  activateMagicSession,
  createLineSession,
  findEmailByLineUserId,
  lineUserIdsForEmail,
  SESSION_DAYS,
  validateSession,
  getSessionToken,
  cookieHeader
};
