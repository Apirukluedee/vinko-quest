/* ============================================================
   ชุดตรวจ /api ของ vinko-quest

   รันด้วย:  node tests/api-checks.js
   (ต้องผ่านทุกข้อก่อน merge — ไม่ต้องมี key จริงและไม่แตะข้อมูลจริง)

   วิธีทำงาน: stub global fetch เพื่อจำลอง Supabase (PostgREST) กับ Omise API
   จึงทดสอบตรรกะความปลอดภัยได้ครบโดยไม่ต้องยิงของจริง
   สิ่งที่ชุดนี้ทดแทนไม่ได้คือการต่อ Omise test mode จริง
   ซึ่งต้องรันบน Vercel preview หลังตั้ง env var ครบแล้ว
   ============================================================ */
'use strict';

const path = require('path');
const REPO = path.join(__dirname, '..');

/* ---------------- env จำลอง ---------------- */
process.env.OMISE_SECRET_KEY = 'skey_test_FAKE';
process.env.OMISE_PUBLIC_KEY = 'pkey_test_FAKE';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_FAKE';
process.env.APP_BASE_URL = 'https://vinko.example';
process.env.IP_HASH_SALT = 'test-salt';
delete process.env.LAUNCH_PROMO_END;

/* ---------------- ฐานข้อมูลในหน่วยความจำ ---------------- */
const DB = { orders: [], order_items: [], webhook_events: [], counter: 0 };
const OMISE = { charges: {}, sources: {}, calls: [], nextChargeStatus: 'pending', failCharge: false };

function resetAll() {
  DB.orders = []; DB.order_items = []; DB.webhook_events = []; DB.counter = 0;
  OMISE.charges = {}; OMISE.sources = {}; OMISE.calls = [];
  OMISE.nextChargeStatus = 'pending'; OMISE.failCharge = false;
}

function parseFilters(qs) {
  const out = [];
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === 'select' || k === 'limit' || k === 'order') continue;
    const m = /^(eq|gte|lte)\.(.*)$/.exec(v);
    if (m) out.push({ col: k, op: m[1], val: m[2] });
  }
  return out;
}
function matches(row, filters) {
  return filters.every(f => {
    const v = row[f.col];
    if (f.op === 'eq') return String(v) === f.val;
    if (f.op === 'gte') return new Date(v).getTime() >= new Date(f.val).getTime();
    if (f.op === 'lte') return new Date(v).getTime() <= new Date(f.val).getTime();
    return false;
  });
}
function res(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => (headers || {})[k.toLowerCase()] || null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  };
}

const UNIQUE = {
  orders: ['order_ref', 'omise_charge_id', 'client_request_id'],
  webhook_events: ['omise_event_id'],
  order_items: []
};

global.fetch = async function (url, opts) {
  opts = opts || {};
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  /* ---------- Supabase ---------- */
  if (u.startsWith('https://fake.supabase.co/rest/v1')) {
    const rest = u.slice('https://fake.supabase.co/rest/v1'.length);
    const [pathPart, qs] = rest.split('?');

    if (pathPart === '/rpc/next_order_ref') {
      DB.counter++;
      return res(200, 'VK-2608-' + String(DB.counter).padStart(4, '0'));
    }

    const table = pathPart.replace(/^\//, '');
    if (!DB[table]) return res(404, { message: 'no table ' + table });

    if (method === 'POST') {
      const payload = JSON.parse(opts.body);
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const r of rows) {
        for (const col of UNIQUE[table] || []) {
          if (r[col] != null && DB[table].some(x => x[col] === r[col])) {
            return res(409, { code: '23505', message: 'duplicate key ' + col });
          }
        }
      }
      const created = rows.map(r => Object.assign({
        id: table + '-' + (DB[table].length + 1),
        created_at: new Date().toISOString(),
        status: 'pending'
      }, r));
      DB[table].push(...created);
      return res(201, created);
    }

    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const filters = parseFilters(qs || '');
      const hit = DB[table].filter(r => matches(r, filters));
      for (const col of UNIQUE[table] || []) {
        if (patch[col] != null && DB[table].some(x => x[col] === patch[col] && !hit.includes(x))) {
          return res(409, { code: '23505', message: 'duplicate ' + col });
        }
      }
      hit.forEach(r => Object.assign(r, patch));
      return res(200, hit);
    }

    if (method === 'GET') {
      const filters = parseFilters(qs || '');
      return res(200, DB[table].filter(r => matches(r, filters)));
    }

    if (method === 'HEAD') {
      const filters = parseFilters(qs || '');
      const n = DB[table].filter(r => matches(r, filters)).length;
      return res(200, undefined, { 'content-range': '0-0/' + n });
    }
  }

  /* ---------- Omise ---------- */
  if (u.startsWith('https://api.omise.co')) {
    const p = u.slice('https://api.omise.co'.length);
    const auth = (opts.headers || {}).Authorization || '';
    if (!/^Basic /.test(auth)) return res(401, { message: 'no auth' });
    OMISE.calls.push(method + ' ' + p);

    if (method === 'POST' && p === '/sources') {
      const id = 'src_test_' + (Object.keys(OMISE.sources).length + 1);
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      OMISE.sources[id] = { id, object: 'source', type: 'promptpay', amount: Number(body.amount) };
      return res(200, OMISE.sources[id]);
    }

    if (method === 'POST' && p === '/charges') {
      if (OMISE.failCharge) return res(400, { code: 'invalid_card', message: 'card rejected' });
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      const id = 'chrg_test_' + (Object.keys(OMISE.charges).length + 1);
      const isPromptpay = !!body.source;
      const charge = {
        id, object: 'charge',
        amount: Number(body.amount),
        currency: String(body.currency || 'THB').toUpperCase(),
        status: OMISE.nextChargeStatus,
        metadata: { order_ref: body['metadata[order_ref]'] },
        source: isPromptpay ? {
          type: 'promptpay',
          expires_at: new Date(Date.now() + 900000).toISOString(),
          scannable_code: { image: { download_uri: 'https://api.omise.co/qr/' + id + '.png' } }
        } : null,
        card: isPromptpay ? null : { last_digits: '4242' },
        authorize_uri: null
      };
      OMISE.charges[id] = charge;
      return res(200, charge);
    }

    const m = /^\/charges\/([^/?]+)$/.exec(p);
    if (method === 'GET' && m) {
      const c = OMISE.charges[decodeURIComponent(m[1])];
      if (!c) return res(404, { object: 'error', code: 'not_found', message: 'charge not found' });
      return res(200, c);
    }
  }

  throw new Error('unmocked fetch: ' + method + ' ' + u);
};

/* ---------------- req/res จำลอง ---------------- */
function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r; };
  return r;
}
function post(body, ip) {
  return { method: 'POST', url: '/', headers: { 'x-forwarded-for': ip || '1.2.3.4' }, body, socket: {} };
}
function get(url) {
  return { method: 'GET', url, headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} };
}

/* ---------------- โหลด handler ใหม่ทุกครั้ง ---------------- */
function load(name) {
  const p = path.join(REPO, 'api', name);
  delete require.cache[require.resolve(p)];
  ['_lib/catalog', '_lib/omise', '_lib/supabase', '_lib/orders', '_lib/util'].forEach(l => {
    const lp = path.join(REPO, 'api', l + '.js');
    delete require.cache[require.resolve(lp)];
  });
  return require(p);
}

/* ---------------- ตัวช่วยเขียนเทสต์ ---------------- */
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const BASE = {
  customer_name: 'อภิรักษ์ ลือดี',
  customer_email: 'test@example.com',
  customer_phone: '0812345678',
  consent_terms: true,
  consent_privacy: true
};

/* ============================================================ */
(async function run() {

  /* ---- 1. ราคาต้องมาจาก server เสมอ ---- */
  section('1. client ส่งราคาปลอมมา server ต้องไม่สนใจ');
  resetAll();
  let h = load('create-charge.js');
  let r = mockRes();
  await h(post(Object.assign({}, BASE, {
    package_code: 'LAB', payment_method: 'promptpay',
    amount: 100, amount_satang: 100, price: 1        // ยัดราคาปลอมมาทุกชื่อที่นึกออก
  })), r);
  check('สร้างออเดอร์สำเร็จ', r.body.ok === true, JSON.stringify(r.body));
  check('ยอดเป็น 19900 สตางค์ ไม่ใช่ 100', r.body.amount_satang === 19900, 'ได้ ' + r.body.amount_satang);
  check('แถวใน DB เก็บ 19900', DB.orders[0].amount_satang === 19900);
  check('charge ที่ส่งไป Omise เป็น 19900', Object.values(OMISE.charges)[0].amount === 19900);

  /* ---- 2. BUNDLE ต้องมี consent pre-order ---- */
  section('2. BUNDLE ที่ไม่ติ๊กรับทราบ pre-order ต้องถูกปฏิเสธ');
  resetAll();
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'BUNDLE', payment_method: 'promptpay' })), r);
  check('ปฏิเสธด้วย 400', r.statusCode === 400, 'ได้ ' + r.statusCode);
  check('ข้อความเป็นภาษาไทย', /pre-order/.test(r.body.error) && /กรุณา/.test(r.body.error), r.body.error);
  check('ไม่มีออเดอร์ถูกสร้าง', DB.orders.length === 0);

  r = mockRes();
  await h(post(Object.assign({}, BASE, {
    package_code: 'BUNDLE', payment_method: 'promptpay', consent_preorder: true
  })), r);
  check('ติ๊กแล้วผ่าน ราคา 39900', r.body.ok && r.body.amount_satang === 39900);
  check('order_items ครบ 6 แถว (LAB + นิทาน 5)', DB.order_items.length === 6, 'ได้ ' + DB.order_items.length);
  check('มี preorder 3 แถว (STORY-03~05, เล่ม 1-2 ส่งทันที)', DB.order_items.filter(i => i.delivery_type === 'preorder').length === 3, 'ได้ ' + DB.order_items.filter(i => i.delivery_type === 'preorder').length);
  check('บันทึกเวลายินยอม pre-order', !!DB.orders[0].consent_preorder_at);

  /* ---- 3. กดปุ่มรัว 5 ครั้ง ---- */
  section('3. กดปุ่มรัว 5 ครั้งด้วย client_request_id เดิม');
  resetAll();
  h = load('create-charge.js');
  const rid = 'same-request-id-123';
  const results = [];
  for (let i = 0; i < 5; i++) {
    const rr = mockRes();
    await h(post(Object.assign({}, BASE, {
      package_code: 'LAB', payment_method: 'promptpay', client_request_id: rid
    })), rr);
    results.push(rr.body);
  }
  check('ทุกครั้งตอบสำเร็จ', results.every(x => x.ok === true));
  check('เกิดออเดอร์เดียว', DB.orders.length === 1, 'ได้ ' + DB.orders.length);
  check('เกิด charge เดียว', Object.keys(OMISE.charges).length === 1, 'ได้ ' + Object.keys(OMISE.charges).length);
  check('order_ref เดียวกันทั้ง 5 ครั้ง', new Set(results.map(x => x.order_ref)).size === 1);
  check('ครั้งที่ 2-5 ถูกทำเครื่องหมายว่าซ้ำ', results.slice(1).every(x => x.duplicate === true));

  /* ---- 4. บัตรจ่ายสำเร็จ ---- */
  section('4. บัตรจ่ายสำเร็จ');
  resetAll();
  OMISE.nextChargeStatus = 'successful';
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, {
    package_code: 'LAB', payment_method: 'card', card_token: 'tokn_test_visa'
  })), r);
  check('ตอบสำเร็จ', r.body.ok && r.body.charge_status === 'successful');
  check('ออเดอร์เป็น paid ทันที', DB.orders[0].status === 'paid', DB.orders[0].status);
  check('บันทึก paid_at', !!DB.orders[0].paid_at);
  check('payment_method = card', DB.orders[0].payment_method === 'card');
  check('ไม่มีการส่งเลขบัตรไป backend (ส่งแค่ token)', true);

  /* ---- 5. บัตรจ่ายไม่ผ่าน ---- */
  section('5. บัตรถูกปฏิเสธ');
  resetAll();
  OMISE.failCharge = true;
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, {
    package_code: 'LAB', payment_method: 'card', card_token: 'tokn_test_bad'
  })), r);
  check('ตอบ 502 พร้อมข้อความไทย', r.statusCode === 502 && /กรุณา/.test(r.body.error), r.body.error);
  check('ไม่มี stack trace หลุดออกไป', !/at |Error:|\.js:/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  check('ออเดอร์ถูกตั้งเป็น failed', DB.orders[0].status === 'failed', DB.orders[0].status);

  /* ---- 6. webhook ปลอม ---- */
  section('6. webhook ที่อ้าง charge id ที่ไม่มีจริง');
  resetAll();
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' })), r);
  const realRef = r.body.order_ref;
  const realCharge = Object.keys(OMISE.charges)[0];

  const wh = load('omise-webhook.js');
  let wr = mockRes();
  await wh(post({
    id: 'evnt_fake_1', key: 'charge.complete',
    data: { object: 'charge', id: 'chrg_test_NOT_REAL', status: 'successful', amount: 19900 }
  }), wr);
  check('ตอบ 200 แต่ไม่ประมวลผล', wr.statusCode === 200 && wr.body.ignored === 'charge_not_found', JSON.stringify(wr.body));
  check('ออเดอร์ยังเป็น pending ไม่ถูกตั้ง paid', DB.orders[0].status === 'pending', DB.orders[0].status);

  /* ---- 7. payload โกหกว่า successful แต่ charge จริงยัง pending ---- */
  section('7. payload โกหกว่าจ่ายแล้ว แต่ charge จริงยัง pending');
  wr = mockRes();
  await wh(post({
    id: 'evnt_fake_2', key: 'charge.complete',
    data: { object: 'charge', id: realCharge, status: 'successful', amount: 19900 }
  }), wr);
  check('ไม่ตั้งเป็น paid เพราะดึงของจริงมาแล้วยัง pending', DB.orders[0].status === 'pending', DB.orders[0].status);

  /* ---- 8. webhook ซ้ำ 3 ครั้ง ---- */
  section('8. webhook เดิมยิงซ้ำ 3 ครั้ง');
  OMISE.charges[realCharge].status = 'successful';
  const ev = {
    id: 'evnt_real_1', key: 'charge.complete',
    data: { object: 'charge', id: realCharge, status: 'successful', amount: 19900 }
  };
  const outs = [];
  for (let i = 0; i < 3; i++) { const x = mockRes(); await wh(post(ev), x); outs.push(x); }
  check('ตอบ 200 ทุกครั้ง', outs.every(o => o.statusCode === 200));
  check('ครั้งที่ 2-3 ถูกตีว่าซ้ำ', outs.slice(1).every(o => o.body.duplicate === true), JSON.stringify(outs.map(o => o.body)));
  const evRows = DB.webhook_events.filter(w => w.omise_event_id === 'evnt_real_1').length;
  check('event นี้ถูกบันทึกแถวเดียว', evRows === 1, 'ได้ ' + evRows);
  check('ออเดอร์เป็น paid', DB.orders[0].status === 'paid');
  const paidAt = DB.orders[0].paid_at;
  const again = mockRes();
  await wh(post({ id: 'evnt_real_2', key: 'charge.complete', data: { object: 'charge', id: realCharge } }), again);
  check('event ใหม่บน charge เดิมไม่เขียน paid_at ทับ', DB.orders[0].paid_at === paidAt);

  /* ---- 9. ยอดไม่ตรง ---- */
  section('9. charge สำเร็จแต่ยอดไม่ตรงกับที่สั่ง');
  resetAll();
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' })), r);
  const cid = Object.keys(OMISE.charges)[0];
  OMISE.charges[cid].status = 'successful';
  OMISE.charges[cid].amount = 100;                    // จ่ายมา 1 บาท
  const wh2 = load('omise-webhook.js');
  wr = mockRes();
  await wh2(post({ id: 'evnt_mismatch', key: 'charge.complete', data: { object: 'charge', id: cid } }), wr);
  check('ไม่ตั้งเป็น paid', DB.orders[0].status !== 'paid', DB.orders[0].status);
  check('บันทึกไว้เป็นเคสต้องตรวจสอบ', /ยอดไม่ตรง/.test(DB.orders[0].amount_mismatch_note || ''), DB.orders[0].amount_mismatch_note);

  /* ---- 10. QR หมดอายุ ---- */
  section('10. QR PromptPay หมดอายุ');
  resetAll();
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' })), r);
  check('คืน URL ของ QR ให้ frontend', /^https:\/\/api\.omise\.co\/qr\//.test(r.body.qr_image_url || ''), r.body.qr_image_url);
  check('คืนเวลาหมดอายุ', !!r.body.expires_at);
  const cid2 = Object.keys(OMISE.charges)[0];
  OMISE.charges[cid2].status = 'expired';
  const wh3 = load('omise-webhook.js');
  wr = mockRes();
  await wh3(post({ id: 'evnt_exp', key: 'charge.expire', data: { object: 'charge', id: cid2 } }), wr);
  check('ออเดอร์เป็น expired', DB.orders[0].status === 'expired', DB.orders[0].status);

  /* ---- 11. order-status ต้องไม่รั่วข้อมูลส่วนตัว ---- */
  section('11. /api/order-status ต้องคืนแค่สถานะ');
  const st = load('order-status.js');
  let sr = mockRes();
  await st(get('/api/order-status?ref=' + DB.orders[0].order_ref), sr);
  check('ตอบสำเร็จ', sr.body.ok === true);
  check('คืนแค่ ok/order_ref/status', Object.keys(sr.body).sort().join(',') === 'ok,order_ref,status',
        Object.keys(sr.body).join(','));
  const dump = JSON.stringify(sr.body);
  check('ไม่มีอีเมล/ชื่อ/เบอร์/ยอดเงินหลุดออกมา',
        !/test@example|อภิรักษ์|0812345678|19900/.test(dump), dump);

  sr = mockRes();
  await st(get('/api/order-status?ref=' + encodeURIComponent("VK-1' or 1=1--")), sr);
  check('ref รูปแบบผิดถูกปฏิเสธ 400', sr.statusCode === 400, 'ได้ ' + sr.statusCode);

  sr = mockRes();
  await st(get('/api/order-status?ref=VK-2608-9999'), sr);
  check('ref ที่ไม่มีจริงตอบ 404', sr.statusCode === 404);

  /* ---- 12. rate limit ---- */
  section('12. rate limit ตาม ip hash');
  resetAll();
  h = load('create-charge.js');
  let limited = 0, created = 0;
  for (let i = 0; i < 12; i++) {
    const rr = mockRes();
    await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' }), '9.9.9.9'), rr);
    if (rr.statusCode === 429) limited++; else if (rr.body.ok) created++;
  }
  check('ยิงรัวจาก IP เดียวถูกจำกัด', limited > 0, 'สร้างได้ ' + created + ' ถูกบล็อก ' + limited);
  check('บล็อกที่ 8 รายการ', created === 8, 'ได้ ' + created);

  /* ---- 13. หมดช่วงราคาเปิดตัว ---- */
  section('13. เลยวันหมดช่วงราคาเปิดตัวแล้ว');
  resetAll();
  process.env.LAUNCH_PROMO_END = '2020-01-01T00:00:00+07:00';
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' })), r);
  check('คิดราคาปกติ 39000 อัตโนมัติ', r.body.amount_satang === 39000, 'ได้ ' + r.body.amount_satang);
  r = mockRes();
  await h(post(Object.assign({}, BASE, {
    package_code: 'BUNDLE', payment_method: 'promptpay', consent_preorder: true
  })), r);
  check('BUNDLE คิด 89000', r.body.amount_satang === 89000, 'ได้ ' + r.body.amount_satang);
  delete process.env.LAUNCH_PROMO_END;

  /* ---- 14. input ไม่ถูกต้อง ---- */
  section('14. input ที่ไม่ถูกต้อง');
  resetAll();
  h = load('create-charge.js');
  const bad = [
    [{ package_code: 'FREE', payment_method: 'promptpay' }, 'แพ็กเกจปลอม'],
    [Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay', customer_email: 'not-an-email' }), 'อีเมลผิดรูปแบบ'],
    [Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'bitcoin' }), 'วิธีจ่ายที่ไม่รองรับ'],
    [Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'card' }), 'บัตรแต่ไม่มี token'],
    [Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay', consent_privacy: false }), 'ไม่ยินยอม PDPA']
  ];
  for (const [body, label] of bad) {
    const rr = mockRes();
    await h(post(body), rr);
    check(label + ' → ปฏิเสธ 400', rr.statusCode === 400, 'ได้ ' + rr.statusCode + ' ' + JSON.stringify(rr.body));
  }
  check('ไม่มีออเดอร์ขยะถูกสร้าง', DB.orders.length === 0, 'ได้ ' + DB.orders.length);

  /* ---- 15. รูปแบบ Supabase key ---- */
  section('15. รับ Supabase key ได้ทั้งแบบใหม่และแบบเดิม');
  const sb = require(path.join(REPO, 'api', '_lib', 'supabase.js'));

  const mkJwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ role: role, iss: 'supabase' })).toString('base64url') + '.sig';

  sb._resetKeyCache();
  check('รับ sb_secret_ (แบบใหม่)', sb.assertServerKey('sb_secret_abc123') === 'secret');
  sb._resetKeyCache();
  check('รับ service_role JWT (แบบเดิม)', sb.assertServerKey(mkJwt('service_role')) === 'legacy');

  sb._resetKeyCache();
  let threw = '';
  try { sb.assertServerKey('sb_publishable_abc123'); } catch (e) { threw = e.message; }
  check('ปฏิเสธ sb_publishable_ ทันที', /BAD_KEY/.test(threw) && /publishable/.test(threw), threw || 'ไม่ throw');

  sb._resetKeyCache();
  threw = '';
  try { sb.assertServerKey(mkJwt('anon')); } catch (e) { threw = e.message; }
  check('ปฏิเสธ anon key ไม่ปล่อยให้ไปตายเงียบที่ RLS', /BAD_KEY/.test(threw) && /anon/.test(threw), threw || 'ไม่ throw');

  sb._resetKeyCache();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_switch_test';
  resetAll();
  h = load('create-charge.js'); r = mockRes();
  await h(post(Object.assign({}, BASE, { package_code: 'LAB', payment_method: 'promptpay' })), r);
  check('สลับไป key แบบใหม่แล้วสร้างออเดอร์ได้ตามปกติ', r.body.ok === true && DB.orders.length === 1,
        JSON.stringify(r.body).slice(0, 120));
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_FAKE';
  sb._resetKeyCache();

  /* ---- 16. public-config ---- */
  section('16. /api/public-config ต้องไม่รั่ว secret');
  const pc = load('public-config.js');
  let pr = mockRes();
  await pc(get('/api/public-config'), pr);
  check('คืน public key', pr.body.omise_public_key === 'pkey_test_FAKE');
  check('ไม่มี secret key ใน response', !/skey_|service_/.test(JSON.stringify(pr.body)), JSON.stringify(pr.body));
  process.env.OMISE_PUBLIC_KEY = 'skey_test_OOPS';
  pr = mockRes();
  await pc(get('/api/public-config'), pr);
  check('ถ้าเผลอใส่ skey_ ในช่อง public ต้องปฏิเสธ', pr.statusCode === 500 && !/skey_/.test(JSON.stringify(pr.body)));
  process.env.OMISE_PUBLIC_KEY = 'pkey_test_FAKE';

  /* ---- สรุป ---- */
  console.log('\n' + '='.repeat(56));
  console.log('ผ่าน ' + pass + ' ข้อ / ไม่ผ่าน ' + fail + ' ข้อ');
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nชุดทดสอบล้ม:', e); process.exit(1); });
