'use strict';

const crypto = require('crypto');
const db     = require('./supabase');

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* สร้าง session พร้อม magic token สำหรับ email login */
async function createMagicSession(email) {
  const magic_token      = genToken();
  const magic_expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const r = await db.insert('user_sessions', { email, magic_token, magic_expires_at });
  if (!r.ok) throw new Error('session_create_failed: ' + JSON.stringify(r.body));
  return { magic_token };
}

/* ตรวจ magic token → คืน {email, session_token} หรือ null */
async function activateMagicSession(magic_token) {
  if (!magic_token) return null;

  const r = await db.select('user_sessions',
    'magic_token=eq.' + encodeURIComponent(magic_token) +
    '&magic_expires_at=gt.' + encodeURIComponent(new Date().toISOString()) +
    '&select=id,email,session_token&limit=1'
  );
  if (!r.ok || !Array.isArray(r.body) || !r.body[0]) return null;

  const { id, email, session_token } = r.body[0];
  await db.update('user_sessions', 'id=eq.' + id, { magic_token: null, magic_expires_at: null });
  return { email, session_token };
}

/* สร้าง session จาก LINE login */
async function createLineSession(email, line_user_id) {
  const r = await db.insert('user_sessions', { email, line_user_id });
  if (!r.ok) throw new Error('session_create_failed');
  const s = Array.isArray(r.body) ? r.body[0] : r.body;
  return { session_token: s.session_token };
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
  const maxAge = 30 * 24 * 3600;
  return `vnk_sid=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

module.exports = {
  createMagicSession,
  activateMagicSession,
  createLineSession,
  validateSession,
  getSessionToken,
  cookieHeader
};
