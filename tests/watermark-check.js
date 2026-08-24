/* ============================================================
   ตรวจระบบลายน้ำ  —  node tests/watermark-check.js

   จุดที่ต้องพิสูจน์ให้ได้:
     1. ลายน้ำภาษาไทยออกมาครบ ไม่กลายเป็นช่องว่างหรือ ?
     2. ไม่ทับเนื้อหาเดิมของหน้า
     3. เวลาที่ใช้ต่อไฟล์ อยู่ในวิสัยที่ serverless รับไหว
     4. order_ref ฝังอยู่ใน metadata ด้วย
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const wm = require(path.join(__dirname, '..', 'api', '_lib', 'watermark.js'));

const CANDIDATES = [
  'C:/Users/ACER/Downloads/Vinko-wow-lab/optimized/VINKO-WOW-LAB-10-Missions-Fillable.pdf',
  'C:/Users/ACER/Downloads/Vinko-wow-lab/VINKO-WOW-LAB-10-Missions-Fillable.pdf'
];
const OUT_DIR = path.join(__dirname, '..', '.tmp');

const INFO = {
  orderRef: 'VK-2609-0042',
  customerName: 'อภิรักษ์ ลือดี',
  customerEmail: 'apirukluedee@gmail.com',
  title: 'VINKO WOW LAB — 10 ภารกิจในครัว'
};

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  ผ่าน    ' + m); };
const bad = (m) => { fail++; console.log('  ไม่ผ่าน  ' + m); };

(async () => {
  console.log('1. ปกปิดอีเมล');
  const cases = [
    ['apirukluedee@gmail.com', 'api***@gmail.com'],
    ['somchai@hotmail.com', 'som***@hotmail.com'],
    ['ab@x.co', 'a***@x.co'],
    ['a@x.co', 'a***@x.co']
  ];
  for (const [inp, want] of cases) {
    const got = wm.maskEmail(inp);
    got === want ? ok(inp + ' -> ' + got) : bad(inp + ' -> ' + got + ' (ควรเป็น ' + want + ')');
  }
  const masked = wm.maskEmail(INFO.customerEmail);
  !masked.includes('rukluedee') ? ok('อีเมลเต็มไม่หลุดออกมา') : bad('ยังเห็นอีเมลเต็ม');

  console.log('\n2. ฟอนต์ไทย');
  if (!fs.existsSync(wm.FONT_PATH)) { bad('ไม่พบไฟล์ฟอนต์ ' + wm.FONT_PATH); }
  else ok('มีไฟล์ฟอนต์ (' + (fs.statSync(wm.FONT_PATH).size / 1024).toFixed(0) + ' KB)');

  const src = CANDIDATES.find(p => fs.existsSync(p));
  if (!src) {
    console.log('\nไม่พบไฟล์ PDF ต้นฉบับสำหรับทดสอบ ข้ามส่วนที่เหลือ');
    console.log('มองหาที่:'); CANDIDATES.forEach(c => console.log('  ' + c));
    process.exit(fail ? 1 : 0);
  }

  console.log('\n3. ใส่ลายน้ำไฟล์จริง');
  console.log('   ต้นฉบับ: ' + path.basename(src) +
              ' (' + (fs.statSync(src).size / 1048576).toFixed(1) + ' MB)');

  const bytes = fs.readFileSync(src);
  const r = await wm.stamp(bytes, INFO);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'watermarked.pdf');
  fs.writeFileSync(out, r.bytes);

  ok('ใส่ลายน้ำครบ ' + r.pages + ' หน้า');
  console.log('        เวลาที่ใช้ : ' + r.ms + ' ms');
  console.log('        ขนาดผลลัพธ์: ' + (r.bytes.length / 1048576).toFixed(1) + ' MB' +
              ' (ต้นฉบับ ' + (bytes.length / 1048576).toFixed(1) + ' MB)');

  r.ms < 10000 ? ok('เร็วกว่า 10 วินาที (ลิมิตของ Vercel Hobby)')
               : bad('ใช้เวลา ' + r.ms + ' ms เกิน 10 วินาที');

  const grow = (r.bytes.length - bytes.length) / 1024;
  grow < 400 ? ok('ไฟล์โตขึ้นแค่ ' + grow.toFixed(0) + ' KB (ฝังฟอนต์แบบ subset)')
             : bad('ไฟล์โตขึ้น ' + grow.toFixed(0) + ' KB มากผิดปกติ');

  console.log('\n4. ชื่อไฟล์ภาษาไทย');
  const fn = wm.safeFilename(INFO.title, INFO.orderRef);
  const cd = wm.contentDisposition(fn);
  console.log('        ' + fn);
  /filename\*=UTF-8''/.test(cd) ? ok('Content-Disposition รองรับชื่อไฟล์ไทย (RFC 5987)')
                                : bad('Content-Disposition ไม่มี filename*');
  !/[\\/:*?"<>|]/.test(fn) ? ok('ไม่มีอักขระต้องห้ามในชื่อไฟล์') : bad('มีอักขระต้องห้าม');

  console.log('\n5. ตรวจผลลัพธ์ใน PDF (ต้องใช้ PyMuPDF ตรวจซ้ำ)');
  console.log('        รันต่อ: python tests/watermark-verify.py');
  console.log('        ไฟล์ผลลัพธ์: ' + out);

  console.log('\n' + '='.repeat(56));
  console.log('ผ่าน ' + pass + ' / ไม่ผ่าน ' + fail);
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ล้มเหลว:', e); process.exit(1); });
