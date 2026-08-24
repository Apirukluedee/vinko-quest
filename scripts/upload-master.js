/* ============================================================
   อัปโหลดไฟล์ต้นฉบับขึ้น Supabase Storage (bucket: masters)

     node scripts/upload-master.js STORY-02 "C:\\path\\to\\book.pdf"

   อ่านคีย์จาก .env.local ที่อยู่นอก git เสมอ ไม่รับคีย์ทาง argument
   และไม่พิมพ์คีย์ออกจอ กันเผลอหลุดไปอยู่ใน history หรือ log

   ใช้แทน upload-master.ps1 ได้เลย ไม่ต้องกังวลเรื่อง BOM ของ PowerShell
   ที่ทำให้ข้อความไทยเพี้ยน
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const BUCKET = 'masters';
const ROOT = path.resolve(__dirname, '..');

function readEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) {
    throw new Error('ไม่พบ .env.local — ต้องมีไฟล์นี้ถึงจะอัปโหลดได้');
  }
  const env = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  });
  return env;
}

async function main() {
  const code = process.argv[2];
  const file = process.argv[3];
  if (!code || !file) {
    console.error('ใช้: node scripts/upload-master.js <CODE> <ไฟล์.pdf>');
    process.exit(1);
  }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    throw new Error('รหัสสินค้าต้องเป็นตัวพิมพ์ใหญ่/ตัวเลข/ขีดกลาง เท่านั้น');
  }
  if (!fs.existsSync(file)) throw new Error('ไม่พบไฟล์: ' + file);

  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('.env.local ขาด SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY');

  const body = fs.readFileSync(file);
  const objectPath = code + '.pdf';
  const mb = (body.length / 1048576).toFixed(2);
  console.log('กำลังอัปโหลด ' + objectPath + ' (' + mb + ' MB)');

  const res = await fetch(url.replace(/\/$/, '') + '/storage/v1/object/' + BUCKET + '/' + objectPath, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true'          // ทับไฟล์เดิม ไม่ให้เกิด "ชื่อไฟล์ (1).pdf"
    },
    body: body
  });

  const text = await res.text();
  if (!res.ok) throw new Error('อัปโหลดไม่สำเร็จ ' + res.status + ' ' + text.slice(0, 300));

  // อ่านกลับมาตรวจว่าขนาดตรงกันจริง ไม่เชื่อแค่ status 200
  const check = await fetch(url.replace(/\/$/, '') + '/storage/v1/object/' + BUCKET + '/' + objectPath, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + key }
  });
  if (!check.ok) throw new Error('อัปโหลดแล้วแต่อ่านกลับไม่ได้ ' + check.status);
  const back = Buffer.from(await check.arrayBuffer());
  if (back.length !== body.length) {
    throw new Error('ขนาดไม่ตรง! ส่งไป ' + body.length + ' ได้กลับ ' + back.length);
  }
  console.log('สำเร็จ — ตรวจแล้วขนาดตรงกัน ' + mb + ' MB');
  console.log('อย่าลืมแก้ APPROX_MB[\'' + code + '\'] ใน api/_lib/catalog.js ให้ตรงกับขนาดนี้');
}

main().catch(function (e) {
  console.error('ผิดพลาด:', e.message);
  process.exit(1);
});
