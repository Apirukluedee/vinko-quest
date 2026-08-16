/* ============================================================
   Omise (Opn Payments) API ผ่าน fetch ตรงๆ ไม่ต้องลง dependency

   secret key อ่านจาก process.env.OMISE_SECRET_KEY เท่านั้น
   ห้ามส่ง secret key ออกไปฝั่ง client ไม่ว่ากรณีใด
   ============================================================ */

'use strict';

const API_MAIN = 'https://api.omise.co';
const VAULT    = 'https://vault.omise.co';

function auth(key) {
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

function secretKey() {
  const k = process.env.OMISE_SECRET_KEY;
  if (!k) throw new Error('ENV_MISSING: OMISE_SECRET_KEY');
  return k;
}

async function request(baseUrl, path, method, key, params) {
  const opts = {
    method: method,
    headers: {
      'Authorization': auth(key),
      'Omise-Version': '2019-05-29'
    }
  };
  if (params) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = encodeForm(params);
  }
  const res = await fetch(baseUrl + path, opts);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: body };
}

/** Omise รับ form-encoded แบบ nested เช่น metadata[order_ref]=... */
function encodeForm(obj, prefix) {
  const parts = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (typeof v === 'object' && !Array.isArray(v)) parts.push(encodeForm(v, key));
    else parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return parts.filter(Boolean).join('&');
}

/** สร้าง source สำหรับ PromptPay (ใช้ secret key ฝั่ง server) */
async function createSource(params) {
  return request(API_MAIN, '/sources', 'POST', secretKey(), params);
}

async function createCharge(params) {
  return request(API_MAIN, '/charges', 'POST', secretKey(), params);
}

/**
 * ดึง charge จริงจาก Omise มาตรวจเอง
 * webhook handler ต้องเรียกตัวนี้เสมอ ห้ามเชื่อ payload ที่ยิงเข้ามา
 */
async function retrieveCharge(chargeId) {
  return request(API_MAIN, '/charges/' + encodeURIComponent(chargeId), 'GET', secretKey(), null);
}

async function retrieveEvent(eventId) {
  return request(API_MAIN, '/events/' + encodeURIComponent(eventId), 'GET', secretKey(), null);
}

/** ดึง URL รูป QR ของ PromptPay ออกจาก charge */
function promptpayQrUrl(charge) {
  const src = charge && charge.source;
  const code = src && src.scannable_code;
  const img = code && code.image;
  return (img && (img.download_uri || img.uri)) || null;
}

module.exports = {
  API_MAIN, VAULT, encodeForm,
  createSource, createCharge, retrieveCharge, retrieveEvent, promptpayQrUrl
};
