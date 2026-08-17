/* ============================================================
   ดึงไฟล์ต้นฉบับจาก Supabase Storage (bucket ส่วนตัวชื่อ masters)

   URL ของ Storage ต้องไม่หลุดถึง browser เด็ดขาด
   ทุกการโหลดวิ่งผ่าน /api/download ของเราเท่านั้น
   ============================================================ */

'use strict';

const BUCKET = 'masters';

function base() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('ENV_MISSING: SUPABASE_URL');
  return url.replace(/\/+$/, '');
}

function key() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('ENV_MISSING: SUPABASE_SERVICE_ROLE_KEY');
  return k;
}

/** ชื่อไฟล์ต้นฉบับใน bucket ตั้งตาม product_code เช่น LAB.pdf, STORY-01.pdf */
function objectPath(productCode) {
  return String(productCode).toUpperCase().replace(/[^A-Z0-9_-]/g, '') + '.pdf';
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
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error('storage ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { BUCKET, objectPath, exists, download };
