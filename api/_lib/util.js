/* ============================================================
   ฟังก์ชันช่วยที่ใช้ร่วมกันทุก endpoint
   ============================================================ */

'use strict';

const crypto = require('crypto');

/** ตอบ JSON พร้อมปิด cache (ข้อมูลออเดอร์ห้ามถูก cache) */
function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

/**
 * ตอบ error ให้ลูกค้าอ่านรู้เรื่องเป็นภาษาไทย
 * รายละเอียดจริงไปอยู่ใน log ฝั่ง server เท่านั้น ห้ามโยน stack trace ออกไป
 */
function fail(res, status, messageTh, logDetail) {
  if (logDetail) console.error('[vinko]', messageTh, '|', logDetail);
  json(res, status, { ok: false, error: messageTh });
}

/** hash IP ด้วย salt — เก็บได้เท่าที่จำเป็นตาม PDPA ไม่เก็บ IP ดิบ */
function hashIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim()
    || req.headers['x-real-ip']
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
  const salt = process.env.IP_HASH_SALT || 'vinko-default-salt';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 32);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^[0-9+\-\s()]{9,20}$/;

function isEmail(v) { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim()); }
function isPhone(v) { return typeof v === 'string' && PHONE_RE.test(v.trim()); }

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/** ตรวจว่า env ที่จำเป็นถูกตั้งครบ ถ้าขาดให้ล้มตั้งแต่ต้นพร้อมบอกว่าขาดตัวไหน */
function requireEnv(names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) throw new Error('ENV_MISSING: ' + missing.join(', '));
}

/** เทียบสตริงแบบเวลาคงที่ กันการเดาทีละตัวอักษร */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

module.exports = { json, fail, hashIp, isEmail, isPhone, clean, requireEnv, safeEqual };
