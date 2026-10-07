/* ============================================================
   Meta Conversions API — ส่ง Purchase ฝั่ง server หลังออเดอร์เป็น paid

   คู่กับ Pixel ฝั่งเบราว์เซอร์ (site.js / thank-you.js)
   ทั้งสองฝั่งใช้ event_id = order_ref -> Meta นับเป็น purchase เดียว

   กติกา:
   1. ส่งเฉพาะออเดอร์ที่ข้อมูลในฐานข้อมูล "พิสูจน์ได้" ว่าลูกค้ากดยอมรับคุกกี้
      = attribution_status 'captured' เท่านั้น (ดู consentProven)
   2. ห้ามขวาง / หน่วง / ทำให้การจ่ายเงิน สถานะออเดอร์ หรือการส่งมอบพัง
      sendPurchase() ไม่ throw เด็ดขาด และมี timeout
      ผู้เรียกต้องเรียกหลังเปลี่ยนสถานะและส่งมอบแล้วเท่านั้น
   3. log ได้แค่ status / code, CAPI_SENT, CAPI_SKIPPED + เหตุผล — ห้าม log อีเมล เบอร์ hash ค่า fbc user agent หรือ token
   4. ไม่มี META_CAPI_ACCESS_TOKEN = ข้ามเงียบๆ เตือนครั้งเดียวต่อ instance
   ============================================================ */

'use strict';

const crypto = require('crypto');
const db     = require('./supabase');
const config = require('./config');

// ต้องตรงกับ ANALYTICS.META_PIXEL_ID ใน assets/js/config.js (มีเทสต์ตรวจ)
const PIXEL_ID = '1366170372169518';
const GRAPH_VERSION = 'v23.0';
const TIMEOUT_MS = 2000;   // ทั้งงานรวมกัน ไม่ใช่แค่ fetch ไป Meta

let warnedNoToken = false;

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

/* อีเมล: ตัดช่องว่าง + ตัวพิมพ์เล็ก (ตามกติกา Meta) ไม่ใช่รูปแบบอีเมล = ไม่ส่ง */
function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/* เบอร์: เหลือแต่ตัวเลข ต้องมีรหัสประเทศ ไม่มี 0 นำหน้า (ตามกติกา Meta)
   ลูกค้าไทยกรอก 0xxxxxxxx(x) -> 66xxxxxxxx(x)
   รูปแบบที่ไม่รู้จัก (เบอร์ต่างประเทศ ฯลฯ) = ไม่ส่ง ดีกว่าเดารหัสประเทศผิด */
function normalizePhone(v) {
  if (typeof v !== 'string') return null;
  const d = v.replace(/\D/g, '');
  if (/^0[1-9]\d{7,8}$/.test(d)) return '66' + d.slice(1);     // 0812345678
  if (/^660[1-9]\d{7,8}$/.test(d)) return '66' + d.slice(3);   // +66 0812345678
  if (/^66[1-9]\d{7,8}$/.test(d)) return d;                    // +66812345678
  return null;
}

/* หลักฐาน consent ที่เก็บคู่ออเดอร์มีแค่ attribution_status (migration 008)
     captured   = checkout ส่ง consent === true มา -> ยอมรับคุกกี้แน่นอน -> ส่ง
     none       = แยกไม่ได้ว่ายอมรับแต่ไม่มี touch หรือ client ไม่ได้ส่ง flag -> ไม่ส่ง
     no_consent / erased / NULL / ค่าอื่น -> ไม่ส่ง                          */
function consentProven(order) {
  return !!order && order.attribution_status === 'captured';
}

/* fbc จาก click id ที่เก็บไว้ เฉพาะ click_id_platform === 'meta'
   รูปแบบ fb.1.<เวลาที่เห็น fbclid เป็น ms>.<fbclid> — ไม่ hash
   ใช้ last ก่อน first; เวลาใช้ t ของ touch นั้น ไม่มีใช้ captured_at */
function buildFbc(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  for (const touch of [snapshot.last, snapshot.first]) {
    if (!touch || typeof touch !== 'object') continue;
    if (touch.click_id_platform !== 'meta') continue;
    const id = touch.click_id_value;
    if (typeof id !== 'string' || !id) continue;
    const ms = Date.parse(touch.t || snapshot.captured_at || '');
    if (!Number.isFinite(ms)) continue;
    return 'fb.1.' + ms + '.' + id;
  }
  return null;
}

/* payload ของ Purchase หนึ่งตัว (pure) — คืน null ถ้าข้อมูลไม่พอจะส่ง */
function buildPurchaseEvent(order, opts) {
  const satang = order && order.amount_satang;
  if (!Number.isSafeInteger(satang) || satang <= 0) return null;
  if (typeof order.currency !== 'string' || order.currency.toUpperCase() !== 'THB') return null;
  if (typeof order.order_ref !== 'string' || !order.order_ref) return null;

  const user = {};
  const em = normalizeEmail(order.customer_email);
  const ph = normalizePhone(order.customer_phone);
  if (em) user.em = [sha256(em)];
  if (ph) user.ph = [sha256(ph)];
  const fbc = buildFbc(order.attribution_snapshot);
  if (fbc) user.fbc = fbc;
  // Meta บังคับใน website event — เก็บตอนกดสั่งซื้อ (migration 009) ไม่ hash
  // ออเดอร์ก่อน 009 ไม่มีค่านี้ ยังส่งได้ แค่จับคู่ได้น้อยลง
  if (typeof order.client_user_agent === 'string' && order.client_user_agent) {
    user.client_user_agent = order.client_user_agent;
  }
  if (!Object.keys(user).length) return null;

  return {
    event_name: 'Purchase',
    event_time: Math.floor(((opts && opts.nowMs) || Date.now()) / 1000),
    event_id: order.order_ref,
    event_source_url: ((opts && opts.baseUrl) || '') + '/thank-you',
    action_source: 'website',
    user_data: user,
    custom_data: {
      value: satang / 100,
      currency: 'THB',
      order_id: order.order_ref,
      content_ids: (opts && opts.contentIds) || (order.package_code ? [String(order.package_code)] : undefined),
      content_type: 'product'
    }
  };
}

function safeCode(v) {
  const s = typeof v === 'number' ? String(v) : v;
  return typeof s === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(s) ? s : '-';
}

/* ข้ามไม่ส่ง — log แค่เหตุผล (คำคงที่) ไม่มีเลขออเดอร์ อีเมล หรือข้อมูลลูกค้า
   ทำให้ดูจาก Vercel Logs ได้ว่าออเดอร์ที่ไม่มี event ใน Meta เป็นเพราะอะไร */
function skip(reason) {
  console.log('[vinko][meta-capi] CAPI_SKIPPED reason: ' + reason);
  return { sent: false, reason: reason };
}

function logFail(status, code) {
  console.error('[vinko][meta-capi] CAPI_FAILED status: ' + (Number.isInteger(status) ? status : '-') +
                ' code: ' + safeCode(code));
}

async function send(orderRef, charge, signal) {
  const token = (process.env.META_CAPI_ACCESS_TOKEN || '').trim();
  if (!token) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.warn('[vinko][meta-capi] META_CAPI_ACCESS_TOKEN not set — server Purchase events are skipped');
    }
    return { sent: false, reason: 'no_token' };
  }

  // เหมือน guard ของ purchase ฝั่ง GA4: ส่งเฉพาะ charge จริงเท่านั้น เสมอ
  // META_TEST_EVENT_CODE แค่เปลี่ยนปลายทางไป Test Events ไม่ได้ปลดล็อก charge ทดสอบ
  if (!charge || charge.livemode !== true) return skip('not_live');
  const testCode = (process.env.META_TEST_EVENT_CODE || '').trim();

  const sel = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) +
    '&select=id,order_ref,status,amount_satang,currency,package_code,customer_email,customer_phone,' +
    'attribution_status,attribution_snapshot,client_user_agent&limit=1');
  if (signal.aborted) return { sent: false, reason: 'timeout' };
  if (!sel.ok) {
    logFail(sel.status, sel.body && sel.body.code);
    return { sent: false, reason: 'db' };
  }
  const order = Array.isArray(sel.body) && sel.body[0];
  if (!order || order.status !== 'paid') return skip('not_paid');
  if (!consentProven(order)) return skip('no_consent');

  // content_ids = รหัสเล่มที่ซื้อจริง (ตะกร้า /books มีหลายเล่ม) ตรงกับฝั่งเบราว์เซอร์
  // อ่านไม่ได้ก็ใช้ package_code แทน ไม่ถือว่าล้มเหลว
  let contentIds = null;
  if (order.package_code === 'CUSTOM' && order.id) {
    const it = await db.select('order_items', 'order_id=eq.' + encodeURIComponent(order.id) + '&select=product_code&order=product_code.asc');
    if (signal.aborted) return { sent: false, reason: 'timeout' };
    if (it.ok && Array.isArray(it.body) && it.body.length) contentIds = it.body.map(r => String(r.product_code));
  }

  const event = buildPurchaseEvent(order, { baseUrl: config.appBaseUrl(), contentIds });
  if (!event) return skip('bad_order');

  const body = { data: [event], access_token: token };
  if (testCode) {
    body.test_event_code = testCode;
    console.warn('[vinko][meta-capi] CAPI test mode ON — remove META_TEST_EVENT_CODE after testing');
  }

  // token อยู่ใน body ไม่ใส่ใน URL — URL มักถูก log โดย proxy / platform
  const r = await fetch('https://graph.facebook.com/' + GRAPH_VERSION + '/' + PIXEL_ID + '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal
  });
  if (!r.ok) {
    let code = null;
    try { const j = await r.json(); code = j && j.error && j.error.code; } catch (e) {}
    if (!signal.aborted) logFail(r.status, code);
    return { sent: false, reason: 'http' };
  }
  // ส่งสำเร็จ — log ยืนยันได้จาก Vercel Logs (เดิม log แค่ตอนพัง แยกไม่ออกว่าส่งหรือข้าม)
  let received = null;
  try { const j = await r.json(); received = j && j.events_received; } catch (e) {}
  console.log('[vinko][meta-capi] CAPI_SENT events_received: ' + (Number.isInteger(received) ? received : '-') +
              (event.user_data.client_user_agent ? '' : ' (no user agent)'));
  return { sent: true };
}

/**
 * ส่ง Purchase ของออเดอร์ที่เพิ่งเป็น paid — ไม่ throw ไม่ว่ากรณีใด
 * ทั้งงาน (อ่าน DB + เรียก Meta) ถูกจำกัดรวมไม่เกิน TIMEOUT_MS
 * เกินเวลา = ทิ้งงานที่ค้าง (ยกเลิก fetch ไป Meta) log แค่ code แล้วคืนทันที
 * @param {string} orderRef
 * @param {object} charge  charge จาก Omise (ใช้ดู livemode เท่านั้น)
 */
async function sendPurchase(orderRef, charge) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { ac.abort(); resolve(null); }, TIMEOUT_MS);
  });
  // .catch ติดไว้กับตัวงานเสมอ — งานที่ถูกทิ้งหลัง timeout ห้ามกลายเป็น unhandled rejection
  const work = send(orderRef, charge, ac.signal).catch(e => {
    if (!ac.signal.aborted) logFail(null, e && e.name);
    return { sent: false, reason: 'error' };
  });
  try {
    const r = await Promise.race([work, timeout]);
    if (r) return r;
    logFail(null, 'TIMEOUT');
    return { sent: false, reason: 'timeout' };
  } catch (e) {
    logFail(null, e && e.name);
    return { sent: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  sendPurchase, buildPurchaseEvent, buildFbc, consentProven,
  normalizeEmail, normalizePhone, sha256, PIXEL_ID, TIMEOUT_MS
};
