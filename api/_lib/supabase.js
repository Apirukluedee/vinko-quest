/* ============================================================
   Supabase ผ่าน PostgREST ตรงๆ ด้วย fetch
   ตั้งใจไม่ใช้ @supabase/supabase-js เพื่อให้ repo นี้ไม่ต้องมี
   package.json / node_modules / ขั้นตอน build เลย

   service_role key ใช้ได้เฉพาะในไฟล์ใต้ /api เท่านั้น
   ห้ามนำ module นี้ไป import ฝั่ง browser เด็ดขาด
   ============================================================ */

'use strict';

function base() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('ENV_MISSING: SUPABASE_URL');
  return url.replace(/\/+$/, '');
}

function headers(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('ENV_MISSING: SUPABASE_SERVICE_ROLE_KEY');
  return Object.assign({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, extra || {});
}

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

module.exports = { insert, insertMany, update, select, count, rpc, isUniqueViolation };
