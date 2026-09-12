/* ============================================================
   แหล่งความจริงเดียวของราคาและรายการไฟล์ — ฝั่ง server เท่านั้น
   ห้ามให้ client ส่งราคามา client ส่งได้แค่ package_code
   ============================================================ */

'use strict';

const config = require('./config');

/* ขนาดไฟล์โดยประมาณหลังใส่ลายน้ำแล้ว (MB) — ใช้บอกลูกค้าก่อนกดโหลด
   คนใช้เน็ตมือถือควรรู้ก่อนว่ากำลังจะโหลดอะไรใหญ่แค่ไหน จะได้ไม่กดแล้วปิดหนี
   วัดจากไฟล์จริงที่ส่งออกไป ถ้าเปลี่ยนไฟล์ต้นฉบับต้องมาแก้ตรงนี้ด้วย */
const APPROX_MB = {
  // วัดจากของจริงด้วยการรัน wm.stamp() กับไฟล์ต้นฉบับ ไม่ใช่ขนาดไฟล์ก่อนลายน้ำ
  'LAB-MAIN': 8.9,
  'LAB-WORKBOOK': 0.9,
  'STORY-01': 5.8,
  'STORY-02': 6.19,
  'STORY-03': 5.7,
  'STORY-04': 6.3,
  'STORY-05': 6.3
};

/** ไฟล์ใหญ่พอที่ต้องเตือนเรื่องเวลาโหลดไหม */
const LARGE_MB = 10;

// ราคาเป็นสตางค์เสมอ (199 บาท = 19900) ห้ามใช้ทศนิยมกับเงิน
//
// ปรับ 9 ก.ย. 2026: เลิกใช้ราคาขีดฆ่าตัวใหญ่ (390/590/890) ที่ไม่เคยขายจริง
// LAB และ BUNDLE ราคาเดียวไม่มีส่วนลด (launch_satang === normal_satang โดยตั้งใจ)
// มีแค่ STORIES ที่ลดจริงช่วงเปิดตัว (249 -> 199) ต้องแก้คู่กับ assets/js/config.js เสมอ
const CATALOG = {
  LAB: {
    code: 'LAB',
    title: 'VINKO WOW LAB: 10 Missions in the Kitchen',
    launch_satang: 19900,
    normal_satang: 19900,
    requires_preorder_consent: false,
    items: [
      { product_code: 'LAB-MAIN', title: 'VINKO WOW LAB — 10 ภารกิจในครัว', delivery_type: 'instant' },
      { product_code: 'LAB-WORKBOOK', title: 'ใบบันทึกนักวิทย์น้อย — ใบงาน 10 ภารกิจ (พิมพ์ออกมาเขียน หรือกรอกลงไฟล์)', delivery_type: 'instant' }
    ]
  },
  BUNDLE: {
    code: 'BUNDLE',
    title: 'BUNDLE: VINKO WOW LAB + VINKO STORIES · เอ๊ะ! อ๋อ! (5 เล่ม)',
    launch_satang: 34900,
    normal_satang: 34900,
    requires_preorder_consent: false,
    items: [
      { product_code: 'LAB-MAIN',  title: 'VINKO WOW LAB — 10 ภารกิจในครัว', delivery_type: 'instant' },
      { product_code: 'LAB-WORKBOOK', title: 'ใบบันทึกนักวิทย์น้อย — ใบงาน 10 ภารกิจ (พิมพ์ออกมาเขียน หรือกรอกลงไฟล์)', delivery_type: 'instant' },
      { product_code: 'STORY-01', title: 'วันที่แรงโน้มถ่วงลางาน (The Day Gravity Took a Day Off)', delivery_type: 'instant' },
      { product_code: 'STORY-02', title: 'คดีสีสันที่หายไป (The Case of the Missing Colors)', delivery_type: 'instant' },
      { product_code: 'STORY-03', title: 'ใครขโมยเสียงของนิวไป? (Who Stole Niew\'s Voice?)', delivery_type: 'instant' },
      { product_code: 'STORY-04', title: 'แม่เหล็กป่วนปาร์ตี้! (Magnet Party Mayhem!)', delivery_type: 'instant' },
      { product_code: 'STORY-05', title: 'อะไรอยู่ในแก้ว? (What\'s in the Cup?)', delivery_type: 'instant' }
    ]
  },
  STORIES: {
    code: 'STORIES',
    title: 'VINKO STORIES · เอ๊ะ! อ๋อ! / Why? Wow! (5 เล่ม)',
    launch_satang: 19900,
    normal_satang: 24900,
    requires_preorder_consent: false,
    items: [
      { product_code: 'STORY-01', title: 'วันที่แรงโน้มถ่วงลางาน (The Day Gravity Took a Day Off)', delivery_type: 'instant' },
      { product_code: 'STORY-02', title: 'คดีสีสันที่หายไป (The Case of the Missing Colors)', delivery_type: 'instant' },
      { product_code: 'STORY-03', title: 'ใครขโมยเสียงของนิวไป? (Who Stole Niew\'s Voice?)', delivery_type: 'instant' },
      { product_code: 'STORY-04', title: 'แม่เหล็กป่วนปาร์ตี้! (Magnet Party Mayhem!)', delivery_type: 'instant' },
      { product_code: 'STORY-05', title: 'อะไรอยู่ในแก้ว? (What\'s in the Cup?)', delivery_type: 'instant' }
    ]
  }
};

function getPackage(code) {
  if (typeof code !== 'string') return null;
  return CATALOG[code.toUpperCase()] || null;
}

/* ============================================================
   ซื้อแยกเล่ม — เล่มละ 59 บาท (หน้า /books)
   ใช้ title ตัวเดียวกับใน STORIES.items เสมอ กันชื่อสองชุดเพี้ยนกัน
   ============================================================ */
const SINGLE_BOOK_SATANG = 5900;
const SINGLE_SELLABLE_CODES = CATALOG.STORIES.items.map(it => it.product_code);

function isSingleSellable(code) {
  return SINGLE_SELLABLE_CODES.includes(String(code || '').toUpperCase());
}

function singleBookTitle(code) {
  const it = CATALOG.STORIES.items.find(i => i.product_code === code);
  return it ? it.title : null;
}

/** ราคารวมของตะกร้าเล่มที่เลือกเอง (สตางค์) — ตัดโค้ดซ้ำและโค้ดที่ขายแยกไม่ได้ทิ้ง */
function customCartTotal(codes) {
  const uniq = Array.from(new Set((codes || []).map(c => String(c).toUpperCase()).filter(isSingleSellable)));
  return uniq.length * SINGLE_BOOK_SATANG;
}

/** แปลงรายการโค้ดที่เลือกเองเป็นแถว order_items เหมือน buildItems() แต่ไม่ผูกกับแพ็กเกจสำเร็จรูป */
function buildCustomItems(codes, orderId) {
  const uniq = Array.from(new Set((codes || []).map(c => String(c).toUpperCase()).filter(isSingleSellable)));
  return uniq.map(code => ({
    order_id: orderId,
    product_code: code,
    title: singleBookTitle(code),
    delivery_type: 'instant',
    scheduled_delivery_date: null
  }));
}

/**
 * ยังอยู่ในช่วงราคาเปิดตัวไหม — ตัดสินจาก env ฝั่ง server เท่านั้น
 * ห้ามเชื่อ config.js ฝั่ง client เพราะผู้ใช้แก้ค่าในเบราว์เซอร์ได้
 * ไม่ตั้ง LAUNCH_PROMO_END = ถือว่ายังอยู่ในช่วงเปิดตัว
 */
function isLaunchPriceActive(now = Date.now()) {
  const raw = config.launchPromoEnd();
  if (!raw) return true;
  const end = new Date(raw).getTime();
  if (Number.isNaN(end)) return true;   // ค่าเพี้ยน = ไม่ขึ้นราคาใส่ลูกค้าเงียบๆ
  return now < end;
}

/** ราคาที่ต้องเก็บจริงของแพ็กเกจนี้ ณ ตอนนี้ (สตางค์) */
function priceSatang(code, now = Date.now()) {
  const pkg = getPackage(code);
  if (!pkg) return null;
  return isLaunchPriceActive(now) ? pkg.launch_satang : pkg.normal_satang;
}

/**
 * กำหนดส่งนิทาน อ่านจาก env STORY_DELIVERY_DATES = "2026-10-15,2026-11-15,..."
 * ยังไม่ตั้ง = คืน null ทุกช่อง (order_items จะมี scheduled_delivery_date เป็น null)
 *
 * schedule_index 0 ว่างไว้ตั้งแต่ STORY-02 เสร็จก่อนกำหนดแล้วเปลี่ยนเป็น instant
 * ห้ามไล่เลข 03/04/05 ใหม่เป็น 0,1,2 ถ้ายังไม่ได้แก้ค่า env ให้เหลือ 3 วัน
 * ไม่งั้น STORY-03 จะไปกินวันของเล่ม 2 (2026-09-01) แล้วปล่อยไฟล์ก่อนที่ไฟล์จะมีจริง
 */
function storyDates() {
  const raw = config.storyDeliveryDates();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

/** แปลงแพ็กเกจเป็นแถวสำหรับ order_items */
function buildItems(code, orderId) {
  const pkg = getPackage(code);
  if (!pkg) return [];
  const dates = storyDates();
  return pkg.items.map(it => ({
    order_id: orderId,
    product_code: it.product_code,
    title: it.title,
    delivery_type: it.delivery_type,
    scheduled_delivery_date:
      it.delivery_type === 'preorder' ? (dates[it.schedule_index] || null) : null
  }));
}

/** ขนาดโดยประมาณของไฟล์นี้ (MB) — null ถ้ายังไม่ได้บันทึกไว้ */
function approxMb(productCode) {
  const v = APPROX_MB[String(productCode).toUpperCase()];
  return typeof v === 'number' ? v : null;
}

/** ไฟล์นี้ใหญ่พอที่ต้องเตือนลูกค้าก่อนกดโหลดไหม */
function isLarge(productCode) {
  const mb = approxMb(productCode);
  return mb !== null && mb >= LARGE_MB;
}

module.exports = {
  CATALOG,
  LARGE_MB,
  SINGLE_BOOK_SATANG,
  getPackage,
  isLaunchPriceActive,
  priceSatang,
  storyDates,
  buildItems,
  approxMb,
  isLarge,
  isSingleSellable,
  singleBookTitle,
  customCartTotal,
  buildCustomItems
};
