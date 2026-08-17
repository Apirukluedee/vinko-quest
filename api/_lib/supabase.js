/* ============================================================
   Supabase ผ่าน PostgREST ตรงๆ ด้วย fetch
   ตั้งใจไม่ใช้ @supabase/supabase-js เพื่อให้ repo นี้ไม่ต้องมี
   package.json / node_modules / ขั้นตอน build เลย

   กุญแจฝั่ง server ใช้ได้เฉพาะในไฟล์ใต้ /api เท่านั้น
   ห้ามนำ module นี้ไป import ฝั่ง browser เด็ดขาด

   รองรับทั้ง sb_secret_ (แบบใหม่) และ service_role JWT (แบบเดิม)
   สลับได้โดยเปลี่ยนแค่ค่า env ไม่ต้องแก้โค้ดในไฟล์นี้
   ============================================================ */

'use strict';

const config = require('./config');

function base() {
  return config.supabaseUrl();
}

/**
 * ตรวจ key ที่ใส่มาว่าเป็น "กุญแจฝั่ง server" จริงไหม แล้วคืนชนิดของมัน
 *
 * รองรับทั้ง 2 รูปแบบ:
 *   - แบบใหม่  sb_secret_...        (แนะนำ เพิกถอนทีละใบได้)
 *   - แบบเดิม  JWT ที่มี role=service_role  (Supabase จะเลิกใช้ภายในสิ้นปี 2026)
 *
 * จุดประสงค์คือ "ผิดแล้วดังทันที" ถ้าเผลอเอา publishable/anon key มาใส่
 * ถ้าไม่ตรวจ มันจะไม่ error ตอนตั้งค่า แต่จะไปเงียบตายตอน RLS บล็อกทุก query
 * ซึ่งอ่านไม่ออกเลยว่าเกิดอะไรขึ้น
 */
let keyKindCache = null;

function assertServerKey(key) {
  if (keyKindCache) return keyKindCache;

  // ตรรกะการตรวจอยู่ที่ config.js ที่เดียว ตรงนี้แค่แปลงผลให้เข้ากับ
  // สัญญาเดิมของฟังก์ชันนี้ (คืนชนิดของ key / throw ด้วยรหัส BAD_KEY)
  const r = config.validate({ SUPABASE_SERVICE_ROLE_KEY: key });
  const bad = r.errors.find(e => e.startsWith('SUPABASE_SERVICE_ROLE_KEY:'));
  if (bad) throw new Error('BAD_KEY: ' + bad.replace(/^SUPABASE_SERVICE_ROLE_KEY:\s*/, ''));

  for (const w of r.warnings) {
    if (w.startsWith('SUPABASE_SERVICE_ROLE_KEY:')) console.warn('[vinko] ' + w);
  }

  keyKindCache = r.supabaseKeyKind || 'unknown';
  return keyKindCache;
}

function headers(extra) {
  const key = config.supabaseKey();
  assertServerKey(key);

  // ส่งทั้ง apikey และ Authorization — รูปแบบเดียวกันนี้ใช้ได้ทั้ง key เก่าและใหม่
  // จึงสลับ key ได้โดยไม่ต้องแตะโค้ดตรงนี้เลย
  return Object.assign({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, extra || {});
}

/** ให้เทสต์ล้าง cache ได้ */
function _resetKeyCache() { keyKindCache = null; }

async function call(path, options) {
  const res = await fetch(base() + '/rest/v1' + path, options);
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
  return { ok: res.ok, status: res.status, body };
}

/** insert แถวเดียว คืนแถวที่สร้าง */
async function insert(table, row, opts) {
  const prefer = ['return=representation'];
  if (opts && opts.ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
  const r = await call('/' + table, {
    method: 'POST',
    headers: headers({ Prefer: prefer.join(',') }),
    body: JSON.stringify(row)
  });
  return r;
}

/** insert หลายแถว */
async function insertMany(table, rows) {
  if (!rows.length) return { ok: true, status: 200, body: [] };
  return call('/' + table, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows)
  });
}

/** update ตามเงื่อนไข query เช่น 'order_ref=eq.VK-2609-0001' */
async function update(table, query, patch) {
  return call('/' + table + '?' + query, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch)
  });
}

/** select — ระบุคอลัมน์เสมอ อย่าใช้ * เพื่อไม่ให้เผลอดึงข้อมูลเกินจำเป็น */
async function select(table, query) {
  return call('/' + table + '?' + query, { method: 'GET', headers: headers() });
}

/** นับแถวโดยไม่ต้องดึงข้อมูลจริง */
async function count(table, query) {
  const res = await fetch(base() + '/rest/v1/' + table + '?' + query, {
    method: 'HEAD',
    headers: headers({ Prefer: 'count=exact', Range: '0-0' })
  });
  const cr = res.headers.get('content-range') || '';
  const n = parseInt(cr.split('/')[1], 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * ยิง query เบาที่สุดเท่าที่ทำได้เพื่อพิสูจน์ว่า key ใช้ได้จริง ไม่ใช่แค่รูปแบบถูก
 * ต่างจาก count() ตรงที่บอกได้ว่า "ล้มเหลว" กับ "มี 0 แถว" คนละเรื่องกัน
 * ห้ามคืนข้อมูลในตารางออกมา — เอาแค่จำนวนกับสถานะ
 */
async function ping() {
  const started = Date.now();
  try {
    const res = await fetch(base() + '/rest/v1/orders?select=id&limit=1', {
      method: 'HEAD',
      headers: headers({ Prefer: 'count=exact', Range: '0-0' })
    });
    const cr = res.headers.get('content-range') || '';
    const n = parseInt(cr.split('/')[1], 10);
    return {
      ok: res.ok,
      status: res.status,
      orders: Number.isNaN(n) ? null : n,
      latency_ms: Date.now() - started
    };
  } catch (e) {
    return { ok: false, status: 0, orders: null, latency_ms: Date.now() - started, error: e.message };
  }
}

/** เรียก SQL function เช่น next_order_ref() */
async function rpc(fn, args) {
  return call('/rpc/' + fn, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args || {})
  });
}

/** ชนกับ unique constraint ไหม (PostgREST คืน 409 + code 23505) */
function isUniqueViolation(r) {
  return r.status === 409 || (r.body && r.body.code === '23505');
}

module.exports = {
  insert, insertMany, update, select, count, ping, rpc, isUniqueViolation,
  assertServerKey, _resetKeyCache
};
