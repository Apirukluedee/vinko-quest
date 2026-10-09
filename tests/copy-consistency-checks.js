/* ============================================================
   ชุดตรวจ "ข้อความขายตรงกับสินค้าจริง" (รีวิวความพร้อมขาย 9 ต.ค. 2569: WEB-01, WEB-02)

   รันด้วย:  node tests/copy-consistency-checks.js
   อ่านไฟล์ในเครื่องอย่างเดียว ไม่ยิงเครือข่าย

   ชื่อเล่มที่ถือเป็นต้นฉบับ: STORY_META ใน api/auth.js (ชั้นหนังสือของลูกค้า)
   ต้องตรงกับ STORY_DELIVERY ใน assets/js/config.js และการ์ดในหน้า /story-sample
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(REPO, rel), 'utf8');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}

// STORY_META ไม่ได้ export ออกมา — อ่านจากซอร์สตรงๆ
const meta = [...read('api/auth.js').matchAll(/'STORY-0(\d)':\s*\{\s*num:\s*\d,\s*title:\s*'([^']+)',\s*topic:\s*'([^']+)'/g)]
  .map(m => ({ num: Number(m[1]), title: m[2], topic: m[3] }));

const sandbox = { window: {} };
vm.runInNewContext(read('assets/js/config.js'), sandbox);
const delivery = sandbox.window.VINKO_CONFIG.STORY_DELIVERY;

const sample = read('story-sample.html');
const grid = sample.slice(sample.indexOf('<!-- Book cards grid -->'), sample.indexOf('<!-- Divider -->'));
const cardTitles = [...grid.matchAll(/margin-bottom:4px">([^<]+)<\/div>/g)].map(m => m[1].trim());
const cardTopics = [...grid.matchAll(/>เรื่อง: ([^<]+)<\/div>/g)].map(m => m[1].trim());

console.log('\nชื่อเล่ม VINKO STORIES');
check('อ่าน STORY_META ได้ครบ 5 เล่ม', () => assert.deepEqual(meta.map(m => m.num), [1, 2, 3, 4, 5]));
check('config.js STORY_DELIVERY ชื่อตรงกับ STORY_META', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(delivery.map(d => d.title))), meta.map(m => m.title));
});
check('/story-sample การ์ดชุดเล่ม: ชื่อตรงกับ STORY_META ครบ 5 เล่มตามลำดับ', () => {
  assert.deepEqual(cardTitles, meta.map(m => m.title));
});
check('/story-sample การ์ดชุดเล่ม: หัวข้อวิทย์ตรงกับ STORY_META', () => {
  assert.deepEqual(cardTopics, meta.map(m => m.topic));
});
check('/story-sample ไม่มีชื่อ/หัวข้อเล่มชุดเก่าหลงเหลือ', () => {
  for (const old of ['น้ำไม่เคยหายไปไหน', 'วัฏจักรน้ำ', 'ทำไมฟ้าถึงสีฟ้า', 'เสียงเดินทางได้อย่างไร', 'ดาวฤกษ์', 'ดาราศาสตร์']) {
    assert.ok(!sample.includes(old), 'ยังมี "' + old + '"');
  }
});

console.log('\nWOW LAB = 2 ไฟล์ (เล่มเต็ม + ใบงาน)');
for (const page of ['books.html', 'checkout.html', 'index.html']) {
  const html = read(page);
  check(page + ' ไม่บอกว่า WOW LAB เป็นหนังสือ "2 เล่ม"', () => {
    assert.ok(!/WOW LAB[^<]{0,40}2 เล่ม|ดิจิทัล 2 เล่ม/.test(html), (html.match(/[^>]{0,40}2 เล่ม[^<]{0,20}/) || [''])[0]);
  });
}
check('books.html ใช้คำเดียวกับหน้าแรก/checkout: "2 ไฟล์ เล่มเต็ม + ใบงาน"', () => {
  const html = read('books.html');
  assert.ok(html.includes('2 ไฟล์ เล่มเต็ม + ใบงาน'));
  assert.ok(read('checkout.html').includes('2 ไฟล์ เล่มเต็ม + ใบงาน'));
});

console.log('\nCopy consistency: ' + passed + ' passed, ' + failed + ' failed (local files only)');
process.exitCode = failed ? 1 : 0;
