/* ============================================================
   ดึงไฟล์ต้นฉบับจาก Supabase Storage (bucket ส่วนตัวชื่อ masters)

   URL ของ Storage ต้องไม่หลุดถึง browser เด็ดขาด
   ทุกการโหลดวิ่งผ่าน /api/download ของเราเท่านั้น
   ============================================================ */

'use strict';

const config = require('./config');

const BUCKET = 'masters';

function base() {
  return config.supabaseUrl();
}

function key() {
  return config.supabaseKey();
}

/** ชื่อไฟล์ต้นฉบับใน bucket ตั้งตาม product_code เช่น LAB.pdf, STORY-01.pdf */
function objectPath(productCode) {
  return String(productCode).toUpperCase().replace(/[^A-Z0-9_-]/g, '') + '.pdf';
}

/**
 * "ไม่มีไฟล์นี้" หรือเปล่า
 *
 * Supabase Storage ไม่ได้ตอบ 404 เวลาไม่เจอ object แต่ตอบ 400 แล้วบอกเหตุผล
 * ไว้ใน body แทน ถ้าเช็กแค่ res.status === 404 กรณีไฟล์หายจะถูกมองเป็น
 * "ระบบพัง" แล้วโยน error ออกไป ลูกค้าจะเห็นข้อความ "ลองใหม่อีกครั้ง"
 * ทั้งที่ลองกี่รอบก็ไม่มีวันได้ไฟล์ (เจอจริงตอน LAB-MAIN.pdf ยังไม่ถูกอัปโหลด)
 */
function isNotFound(status, body) {
  if (status === 404) return true;
  return status === 400 && /not[_ ]?found/i.test(String(body || ''));
}

/** ไฟล์ต้นฉบับมีอยู่จริงไหม (ใช้ก่อนส่งอีเมลแจ้งว่าของพร้อมแล้ว) */
async function exists(productCode) {
  const res = await fetch(
    base() + '/storage/v1/object/info/' + BUCKET + '/' + objectPath(productCode),
    { method: 'GET', headers: { apikey: key(), Authorization: 'Bearer ' + key() } }
  );
  return res.ok;
}

/**
 * ดึงไฟล์ต้นฉบับมาเป็น Buffer
 * @returns {Promise<Buffer|null>} null ถ้ายังไม่มีไฟล์นี้ใน bucket
 */
async function download(productCode) {
  const res = await fetch(
    base() + '/storage/v1/object/' + BUCKET + '/' + objectPath(productCode),
    { method: 'GET', headers: { apikey: key(), Authorization: 'Bearer ' + key() } }
  );
  if (!res.ok) {
    const body = await res.text().catch(function () { return ''; });
    if (isNotFound(res.status, body)) return null;
    throw new Error('storage ' + res.status + ' ' + body.slice(0, 200));
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { BUCKET, objectPath, exists, download, isNotFound };
