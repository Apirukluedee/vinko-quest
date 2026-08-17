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

function base() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('ENV_MISSING: SUPABASE_URL');
  return url.replace(/\/+$/, '');
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

  if (key.startsWith('sb_publishable_')) {
    throw new Error('BAD_KEY: SUPABASE_SERVICE_ROLE_KEY เป็น publishable key (sb_publishable_) ' +
                    'ต้องใช้ secret key (sb_secret_) เท่านั้น');
  }
  if (key.startsWith('sb_secret_')) {
    keyKindCache = 'secret';
    return keyKindCache;
  }
  if (key.startsWith('eyJ')) {
    // key แบบเดิมเป็น JWT อ่าน claim "role" ออกมาดูได้เลยว่าใช่ service_role ไหม
    let role = null;
    try {
      const part = key.split('.')[1];
      role = JSON.parse(Buffer.from(part, 'base64').toString('utf8')).role;
    } catch (e) { /* ถอดไม่ออกก็ปล่อยผ่าน ให้ Supabase เป็นคนปฏิเสธเอง */ }

    if (role === 'anon') {
      throw new Error('BAD_KEY: SUPABASE_SERVICE_ROLE_KEY เป็น anon key ' +
                      'ซึ่งอ่านตารางไม่ได้เลยเพราะ RLS ต้องใช้ service_role หรือ sb_secret_');
    }
    console.warn('[vinko] กำลังใช้ Supabase key แบบเดิม (legacy JWT) — ' +
                 'Supabase จะเลิกรองรับภายในสิ้นปี 2026 ควรย้ายไป sb_secret_ ก่อนเปิดขายจริง');
    keyKindCache = 'legacy';
    return keyKindCache;
  }

  console.warn('[vinko] รูปแบบ SUPABASE_SERVICE_ROLE_KEY ไม่คุ้นเคย ส่งไปให้ Supabase ตัดสินเอง');
  keyKindCache = 'unknown';
  return keyKindCache;
}

function headers(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('ENV_MISSING: SUPABASE_SERVICE_ROLE_KEY');
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
  insert, insertMany, update, select, count, rpc, isUniqueViolation,
  assertServerKey, _resetKeyCache
};
