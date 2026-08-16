/* ============================================================
   ตรวจว่า Supabase key ที่ตั้งไว้ใช้งานได้จริงกับ project จริง

   รันด้วย:  node tests/supabase-smoke.js
   อ่านค่าจาก .env.local ถ้ามี ไม่งั้นใช้ตัวแปรที่ตั้งไว้ใน shell

   ใช้ตอนสลับ key จาก service_role แบบเดิม ไป sb_secret_ แบบใหม่
   ถ้าผ่าน = ใส่ค่าเดียวกันนี้บน Vercel ได้เลย
   ถ้าไม่ผ่าน = ใส่ key เดิมกลับ ไม่มีอะไรเสียหาย

   สคริปต์นี้ "อ่านอย่างเดียว" ไม่เขียนหรือลบข้อมูลใดๆ
   และไม่พิมพ์ค่า key ออกมาทางหน้าจอ
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- โหลด .env.local แบบง่ายๆ ไม่ต้องพึ่ง dotenv ---------- */
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  console.log('อ่านค่าจาก .env.local แล้ว\n');
} else {
  console.log('ไม่พบ .env.local — ใช้ตัวแปรจาก shell แทน\n');
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ผ่าน   ' + m); };
const bad = (m) => { fail++; console.log('  ไม่ผ่าน ' + m); };

/* ---------- 1. env ครบไหม ---------- */
console.log('1. ตรวจค่า environment');
if (!URL) { bad('ไม่ได้ตั้ง SUPABASE_URL'); }
else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(URL.trim())) {
  bad('SUPABASE_URL รูปแบบแปลก: ' + URL);
} else ok('SUPABASE_URL ถูกต้อง');

if (!KEY) bad('ไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY');
else ok('มี SUPABASE_SERVICE_ROLE_KEY (ยาว ' + KEY.length + ' ตัวอักษร)');

if (!URL || !KEY) {
  console.log('\nตั้งค่าให้ครบก่อนแล้วรันใหม่');
  process.exit(1);
}

/* ---------- 2. ชนิดของ key ---------- */
console.log('\n2. ชนิดของ key');
const db = require(path.join(__dirname, '..', 'api', '_lib', 'supabase.js'));
let kind;
try {
  kind = db.assertServerKey(KEY);
  if (kind === 'secret') ok('เป็น secret key แบบใหม่ (sb_secret_) — แบบที่ควรใช้');
  else if (kind === 'legacy') ok('เป็น service_role JWT แบบเดิม — ใช้ได้ แต่ Supabase จะเลิกรองรับสิ้นปี 2026');
  else ok('รูปแบบไม่คุ้นเคย จะลองยิงจริงดู');
} catch (e) {
  bad(e.message);
  console.log('\nแก้ค่า key ให้ถูกก่อนแล้วรันใหม่');
  process.exit(1);
}

/* ---------- 3. ยิงจริง ---------- */
(async () => {
  const base = URL.replace(/\/+$/, '');
  const h = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json'
  };

  console.log('\n3. เชื่อมต่อ PostgREST จริง (อ่านอย่างเดียว)');
  for (const table of ['orders', 'order_items', 'download_events', 'webhook_events']) {
    try {
      const r = await fetch(base + '/rest/v1/' + table + '?select=id&limit=1', { headers: h });
      if (r.ok) ok('อ่านตาราง ' + table + ' ได้ (HTTP ' + r.status + ')');
      else {
        const body = await r.text();
        bad('อ่านตาราง ' + table + ' ไม่ได้ (HTTP ' + r.status + ') ' + body.slice(0, 160));
      }
    } catch (e) {
      bad('ยิงไปที่ ' + table + ' ไม่สำเร็จ: ' + e.message);
    }
  }

  console.log('\n4. เรียกฟังก์ชัน next_order_ref()');
  console.log('   (สร้างเลขที่ออเดอร์จริง 1 เลข เลขจะเดินไป 1 ขั้น ไม่กระทบข้อมูลอื่น)');
  try {
    const r = await fetch(base + '/rest/v1/rpc/next_order_ref', { method: 'POST', headers: h, body: '{}' });
    const t = await r.text();
    if (r.ok && /^"?VK-\d{4}-\d{4,}"?$/.test(t.trim())) ok('ได้เลขที่ออเดอร์: ' + t.trim().replace(/"/g, ''));
    else bad('เรียกไม่สำเร็จ (HTTP ' + r.status + ') ' + t.slice(0, 160));
  } catch (e) {
    bad('เรียกฟังก์ชันไม่สำเร็จ: ' + e.message);
  }

  console.log('\n' + '='.repeat(56));
  if (fail === 0) {
    console.log('ผ่านทั้งหมด ' + pass + ' ข้อ');
    console.log('key ชุดนี้ใช้ได้จริง เอาไปใส่บน Vercel แล้ว Redeploy ได้เลย');
    if (kind === 'legacy') {
      console.log('\nหมายเหตุ: ยังเป็น key แบบเดิมอยู่');
      console.log('สร้าง sb_secret_ ใหม่แล้วรันสคริปต์นี้ซ้ำเพื่อทดสอบก่อนสลับได้');
    }
  } else {
    console.log('ผ่าน ' + pass + ' / ไม่ผ่าน ' + fail);
    console.log('ยังใช้ไม่ได้ — ใส่ key เดิมกลับไปก่อน ไม่มีอะไรเสียหาย');
    console.log('ถ้า HTTP 401/403 = key ผิดหรือถูกเพิกถอน');
    console.log('ถ้า HTTP 404 = ยังไม่ได้รัน supabase/migrations/001_init.sql');
  }
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})();
