/* ============================================================
   สร้าง content/support-pack.md — ชุดข้อมูลสำหรับ Claude Project
   ที่ใช้ร่างคำตอบลูกค้า LINE (อัปโหลดเป็น Project knowledge)

   ที่มา: content/support-pack.template.md (ข้อความ/นโยบาย เขียนมือ)
        + assets/js/config.js (ราคา วันโปร ชื่อภารกิจ/นิทาน ช่องทางติดต่อ)

   รัน:      node scripts/build-support-pack.js
   ตรวจ:     node scripts/build-support-pack.js --check
             (exit 1 ถ้าไฟล์ที่ commit ไว้ไม่ตรงกับ config ปัจจุบัน)

   ไม่แตะเครือข่าย ไม่อ่าน env ไม่ดึงข้อมูลส่วนตัวผู้ขาย (SELLER) มาใส่
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'content', 'support-pack.template.md');
const OUT = path.join(ROOT, 'content', 'support-pack.md');
const CONFIG = path.join(ROOT, 'assets', 'js', 'config.js');

function loadConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(CONFIG, 'utf8'), sandbox, { filename: CONFIG });
  const cfg = sandbox.window.VINKO_CONFIG;
  if (!cfg || !cfg.PRICES) throw new Error('อ่าน VINKO_CONFIG จาก config.js ไม่ได้');
  return cfg;
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/* "2026-12-31T23:59:59+07:00" -> "31 ธ.ค. 2026" (อ่านจากข้อความ ไม่พึ่ง timezone เครื่อง) */
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Number(m[3]) + ' ' + TH_MONTHS[Number(m[2]) - 1] + ' ' + m[1];
}

function priceNote(p, until) {
  if (p.normal === p.launch) return ' (ราคาเดียว ไม่มีส่วนลดช่วงเปิดตัว)';
  const when = until ? ' ถึง ' + until : '';
  return ' (ราคาเปิดตัว' + when + ' หลังจากนั้นราคาปกติ ' + p.normal + ' บาท)';
}

function build(cfg) {
  const P = cfg.PRICES;
  const until = fmtDate(cfg.LAUNCH_PROMO_END);
  const singleTotal = cfg.SINGLE_BOOK_PRICE * cfg.STORY_DELIVERY.length;

  const promo = until
    ? '- ราคาเปิดตัวของ Stories หมดวันที่ ' + until + ' (ตาม config) หลังจากนั้นเว็บสลับเป็นราคาปกติเอง ถ้าลูกค้าถามเรื่องหมดโปรเมื่อไร ให้ตอบวันนี้'
    : '- ยังไม่กำหนดวันหมดราคาเปิดตัว อย่าบอกลูกค้าว่าหมดเมื่อไร';

  const vars = {
    SITE: cfg.SITE_URL,
    LINE_URL: cfg.LINE_URL,
    EMAIL: cfg.CONTACT_EMAIL,
    LAB_PRICE: P.lab.launch,
    LAB_NOTE: priceNote(P.lab, until),
    STORIES_PRICE: P.stories.launch,
    STORIES_NOTE: priceNote(P.stories, until),
    BUNDLE_PRICE: P.bundle.launch,
    BUNDLE_NOTE: priceNote(P.bundle, until),
    SINGLE_PRICE: cfg.SINGLE_BOOK_PRICE,
    SINGLE_TOTAL: singleTotal,
    UPGRADE_PRICE: cfg.UPGRADE_PRICE,
    PROMO_LINE: promo,
    MISSIONS: cfg.MISSIONS.map((m, i) => '  ' + (i + 1) + '. ' + m).join('\n'),
    STORIES: cfg.STORY_DELIVERY.map((s) => '  ' + s.no + '. ' + s.title + ' / ' + s.title_en).join('\n')
  };

  let out = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
  out = out.replace(/\{\{([A-Z_]+)\}\}/g, (all, key) => {
    if (!(key in vars)) throw new Error('template มี placeholder ที่ไม่รู้จัก: ' + all);
    return String(vars[key]);
  });
  return out;
}

function main() {
  const out = build(loadConfig());
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== out) {
      console.error('content/support-pack.md ไม่ตรงกับ config/template — รัน: npm run build:support-pack');
      process.exit(1);
    }
    console.log('support-pack.md ตรงกับ config ปัจจุบัน');
    return;
  }
  fs.writeFileSync(OUT, out);
  console.log('เขียน ' + path.relative(ROOT, OUT) + ' (' + out.length + ' ตัวอักษร)');
}

main();
