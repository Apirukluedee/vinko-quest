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
  'LAB-MAIN': 6.1,
  'STORY-01': 6.2,
  'STORY-02': 5.7
};

/** ไฟล์ใหญ่พอที่ต้องเตือนเรื่องเวลาโหลดไหม */
const LARGE_MB = 10;

// ราคาเป็นสตางค์เสมอ (199 บาท = 19900) ห้ามใช้ทศนิยมกับเงิน
const CATALOG = {
  LAB: {
    code: 'LAB',
    title: 'VINKO WOW LAB: 10 Missions in the Kitchen',
    launch_satang: 19900,
    normal_satang: 39000,
    requires_preorder_consent: false,
    items: [
      { product_code: 'LAB-MAIN', title: 'VINKO WOW LAB — 10 ภารกิจในครัว', delivery_type: 'instant' }
    ]
  },
  BUNDLE: {
    code: 'BUNDLE',
    title: 'BUNDLE: VINKO WOW LAB + VINKO Stories (5 เล่ม)',
    launch_satang: 39900,
    normal_satang: 89000,
    requires_preorder_consent: true,
    items: [
      { product_code: 'LAB-MAIN',  title: 'VINKO WOW LAB — 10 ภารกิจในครัว', delivery_type: 'instant' },
      { product_code: 'STORY-01', title: 'วันที่แรงโน้มถ่วงลางาน (The Day Gravity Took a Day Off)', delivery_type: 'instant' },
      { product_code: 'STORY-02', title: 'คดีสีสันที่หายไป (The Case of the Missing Colors)', delivery_type: 'preorder', schedule_index: 0 },
      { product_code: 'STORY-03', title: 'ใครขโมยเสียงของนิวไป? (Who Stole Niew\'s Voice?)', delivery_type: 'preorder', schedule_index: 1 },
      { product_code: 'STORY-04', title: 'แม่เหล็กป่วนปาร์ตี้! (Magnet Party Mayhem!)', delivery_type: 'preorder', schedule_index: 2 },
      { product_code: 'STORY-05', title: 'ขุมทรัพย์ในน้ำแข็ง (Treasure in the Ice)', delivery_type: 'preorder', schedule_index: 3 }
    ]
  },
  STORIES: {
    code: 'STORIES',
    title: 'VINKO Stories: เอ๊ะ?...จนอ๋อ! / Why? Wow! (5 เล่ม)',
    launch_satang: 29900,
    normal_satang: 59000,
    requires_preorder_consent: true,
    items: [
      { product_code: 'STORY-01', title: 'วันที่แรงโน้มถ่วงลางาน (The Day Gravity Took a Day Off)', delivery_type: 'instant' },
      { product_code: 'STORY-02', title: 'คดีสีสันที่หายไป (The Case of the Missing Colors)', delivery_type: 'preorder', schedule_index: 0 },
      { product_code: 'STORY-03', title: 'ใครขโมยเสียงของนิวไป? (Who Stole Niew\'s Voice?)', delivery_type: 'preorder', schedule_index: 1 },
      { product_code: 'STORY-04', title: 'แม่เหล็กป่วนปาร์ตี้! (Magnet Party Mayhem!)', delivery_type: 'preorder', schedule_index: 2 },
      { product_code: 'STORY-05', title: 'ขุมทรัพย์ในน้ำแข็ง (Treasure in the Ice)', delivery_type: 'preorder', schedule_index: 3 }
    ]
  }
};

function getPackage(code) {
  if (typeof code !== 'string') return null;
  return CATALOG[code.toUpperCase()] || null;
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
  getPackage,
  isLaunchPriceActive,
  priceSatang,
  storyDates,
  buildItems,
  approxMb,
  isLarge
};
