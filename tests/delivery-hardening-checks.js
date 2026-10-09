/* ============================================================
   ชุดตรวจ "จ่ายแล้วต้องได้ของ" เมื่อระบบล้มกลางทาง (รีวิวความพร้อมขาย 9 ต.ค. 2569)

   รันด้วย:  node tests/delivery-hardening-checks.js
   ไม่ยิงเครือข่าย — Supabase/Omise ถูก stub, อีเมล/LINE/CAPI ถูกแทนด้วยตัวปลอม

   ครอบคลุม:
     PAY-01  อีเมลส่งไม่ออก → webhook ต้องตอบ 500 และปล่อยให้ Omise retry ได้จริง
     PAY-02  DB ล้มตอนอัปเดตออเดอร์ → ห้ามตอบ 200 / retry ต้องทำงานใหม่ได้
     PAY-04  ออเดอร์ paid แล้วแต่ยังไม่ส่งของ → event ถัดไปต้องส่งให้
     cron    ไล่ซ่อมออเดอร์ 7 วันล่าสุด (pending ที่จ่ายจริง / paid ที่ยังไม่ได้อีเมล)
     PAY-03  ชั้นหนังสือหาออเดอร์เจอแม้อีเมลตอนซื้อมีตัวพิมพ์ใหญ่
     reader  reader_token ที่หายถูกออกให้ และสองทางออกพร้อมกันได้ค่าเดียวกัน
     DL      PDF ใหญ่ถูกทยอยเขียนทีละ 1 MB ไม่ส่งก้อนเดียว (เพดาน 4.5 MB ของ Vercel)
   ============================================================ */
'use strict';

const path = require('path');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');

let passed = 0, failed = 0, finished = false;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}
function section(t) { console.log('\n' + t); }
process.on('exit', () => {
  if (!finished) { console.log('\nFAIL  ชุดทดสอบไม่จบ — ' + passed + ' passed ก่อนค้าง'); process.exitCode = 1; }
});

Object.assign(process.env, {
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FAKEFAKEFAKEFAKE',
  OMISE_SECRET_KEY: 'skey_test_FAKE', OMISE_PUBLIC_KEY: 'pkey_test_FAKE', APP_BASE_URL: 'https://vinko.quest',
  IP_HASH_SALT: 'salt-fixture', RESEND_API_KEY: 're_FAKE', CRON_SECRET: 'cron-secret-fixture'
});
delete process.env.OMISE_WEBHOOK_SECRET;

/* ---------------- Supabase ปลอม (PostgREST แบบย่อ) ---------------- */
const SB = 'https://fake.supabase.co/rest/v1/';
const TABLES = ['orders', 'order_items', 'webhook_events', 'email_events', 'download_events', 'user_sessions'];
const S = {};
const FAULT = { email: false, ordersPatch: false, webhookDelete: false };
const CHARGES = {};
function reset() {
  TABLES.forEach(t => { S[t] = []; });
  Object.keys(FAULT).forEach(k => { FAULT[k] = false; });
  Object.keys(CHARGES).forEach(k => delete CHARGES[k]);
  MAILS.length = 0; LINE_SENT.length = 0; CAPI_SENT.length = 0;
}
const reply = (status, body, headers) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: k => (headers || {})[k.toLowerCase()] || null },
  text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });

// ilike แบบ PostgREST: \x = ตัวอักษรตรงตัว, % และ * = อะไรก็ได้, _ = อักขระเดียว
function ilikeRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%' || c === '*') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}
function filtersOf(qs) {
  return [...new URLSearchParams(qs || '')].filter(([k]) => !['select', 'limit', 'order', 'offset'].includes(k));
}
function match(row, fs) {
  return fs.every(([k, v]) => {
    const x = row[k];
    if (v === 'is.null') return x == null;
    if (v === 'not.is.null') return x != null;
    if (v.startsWith('eq.')) return String(x) === v.slice(3);
    if (v.startsWith('gte.')) return x != null && new Date(x) >= new Date(v.slice(4));
    if (v.startsWith('gt.')) return x != null && new Date(x) > new Date(v.slice(3));
    if (v.startsWith('lte.')) return x != null && String(x) <= v.slice(4);
    if (v.startsWith('ilike.')) return x != null && ilikeRe(v.slice(6)).test(String(x));
    throw new Error('mock: unsupported filter ' + k + '=' + v);
  });
}
const SEEN_QUERIES = [];
global.fetch = async (url, opts) => {
  opts = opts || {};
  const u = String(url), method = (opts.method || 'GET').toUpperCase();

  if (u.startsWith('https://api.omise.co/charges/') && method === 'GET') {
    const c = CHARGES[u.split('/').pop()];
    return c ? reply(200, c) : reply(404, { object: 'error', code: 'not_found' });
  }
  if (!u.startsWith(SB)) throw new Error('unmocked fetch ' + method + ' ' + u);

  const [table, qs] = u.slice(SB.length).split('?');
  if (!S[table]) return reply(404, { message: 'no table ' + table });
  SEEN_QUERIES.push(method + ' ' + table + '?' + (qs || ''));
  const fs = filtersOf(qs);

  if (method === 'HEAD') return reply(200, undefined, { 'content-range': '0-0/' + S[table].filter(r => match(r, fs)).length });
  if (method === 'GET') {
    const sel = new URLSearchParams(qs).get('select') || '';
    return reply(200, S[table].filter(r => match(r, fs)).map(r => {
      const o = Object.assign({}, r);
      if (table === 'orders' && /order_items\(/.test(sel)) o.order_items = S.order_items.filter(i => i.order_id === r.id);
      return o;
    }));
  }
  if (method === 'POST') {
    const rows = [].concat(JSON.parse(opts.body));
    if (table === 'webhook_events' && S.webhook_events.some(e => e.omise_event_id === rows[0].omise_event_id)) {
      return reply(409, { code: '23505' });
    }
    const made = rows.map(r => Object.assign({ id: table + '-' + (S[table].length + 1), created_at: new Date().toISOString() }, r));
    S[table].push(...made);
    return reply(201, made);
  }
  if (method === 'PATCH') {
    if (table === 'orders' && FAULT.ordersPatch) return reply(503, { code: 'PGRST000', message: 'db down' });
    const hit = S[table].filter(r => match(r, fs));
    hit.forEach(r => Object.assign(r, JSON.parse(opts.body)));
    return reply(200, hit.map(r => Object.assign({}, r)));
  }
  if (method === 'DELETE') {
    if (table === 'webhook_events' && FAULT.webhookDelete) return reply(503, { code: 'PGRST000' });
    S[table] = S[table].filter(r => !match(r, fs));
    return reply(204, undefined);
  }
  throw new Error('unmocked ' + method + ' ' + u);
};

/* ---------------- อีเมล / LINE / CAPI ปลอม ---------------- */
const MAILS = [], LINE_SENT = [], CAPI_SENT = [];
function stub(rel, exports) {
  const p = require.resolve(path.join(REPO, 'api', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('_lib/email.js', {
  purchaseEmail: o => ({ subject: 'x', html: 'token=' + o.token, readerToken: o.readerToken }),
  storyEmail: () => ({ subject: 'story', html: 'x' }),
  send: async (kind, to, payload, meta) => {
    const ok = !FAULT.email;
    S.email_events.push({ order_id: meta && meta.orderId, kind, status: ok ? 'sent' : 'failed' });
    if (ok) MAILS.push({ kind, to, payload });
    return ok ? { ok: true, id: 'msg_' + MAILS.length } : { ok: false, error: 'provider said no for ' + to };
  },
  connectLineUrl: () => null, CONNECT_TTL_PAGE_MS: 1800000, CONNECT_TTL_EMAIL_MS: 1
});
stub('_lib/line.js', { notifyOrder: async ref => { LINE_SENT.push(ref); return { ok: true }; } });
stub('_lib/meta-capi.js', { sendPurchase: async ref => { CAPI_SENT.push(ref); } });

const webhook = require(path.join(REPO, 'api', 'omise-webhook.js'));
const cron = require(path.join(REPO, 'api', 'cron', 'deliver-preorders.js'));
const auth = require(path.join(REPO, 'api', 'auth.js'));
const tokens = require(path.join(REPO, 'api', '_lib', 'tokens.js'));

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null, chunks: [], writes: 0, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.getHeader = k => r.headers[k.toLowerCase()];
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r; };
  r.write = b => { r.writes++; r.chunks.push(Buffer.from(b)); return true; };
  r.end = () => { r.ended = true; return r; };
  r.once = () => r;
  return r;
}
const hook = (eventId, chargeId) => ({ method: 'POST', url: '/', headers: {}, socket: {},
  body: { id: eventId, key: 'charge.complete', data: { object: 'charge', id: chargeId } } });

const DAY = 86400000;
function seed(over) {
  const n = S.orders.length + 1;
  const o = Object.assign({
    id: 'ord-' + n, order_ref: 'VK-2610-000' + n, status: 'pending', package_code: 'LAB',
    customer_name: 'ผู้ปกครอง', customer_email: 'buyer@example.invalid',
    amount_satang: 19900, currency: 'THB', omise_charge_id: 'chrg_' + n,
    download_token: null, token_expires_at: null, reader_token: null,
    created_at: new Date().toISOString(), paid_at: null
  }, over);
  S.orders.push(o);
  S.order_items.push({ id: 'it-' + n, order_id: o.id, product_code: 'LAB-MAIN', title: 'WOW LAB',
                       delivery_type: 'instant', scheduled_delivery_date: null, delivered_at: null, refunded_at: null });
  CHARGES[o.omise_charge_id] = { object: 'charge', id: o.omise_charge_id, status: 'successful',
                                 amount: o.amount_satang, currency: 'thb', livemode: true, source: { type: 'promptpay' } };
  return o;
}
const logs = [];
const origErr = console.error, origWarn = console.warn;
console.error = (...a) => { logs.push(a.join(' ')); };
console.warn = (...a) => { logs.push(a.join(' ')); };

(async () => {
  /* ---------------- PAY-01 ---------------- */
  section('PAY-01 อีเมลส่งไม่ออก → ต้องไม่ถือว่าส่งมอบแล้ว');
  reset(); let o = seed();
  FAULT.email = true;
  let r = mockRes(); await webhook(hook('evnt_1', o.omise_charge_id), r);
  await check('ตอบ 500 ให้ Omise ส่ง event เดิมมาใหม่', () => assert.equal(r.statusCode, 500));
  await check('ลบแถวกันซ้ำทิ้ง (ไม่งั้น retry จะโดนตีว่าซ้ำ)', () => assert.equal(S.webhook_events.length, 0));
  await check('ออเดอร์เป็น paid + มี token แล้ว (หน้าขอบคุณโหลดได้)', () => {
    assert.equal(o.status, 'paid'); assert.ok(o.download_token);
  });
  await check('CAPI + แจ้ง LINE ยิงครั้งเดียวตอนเปลี่ยนเป็น paid', () => {
    assert.deepEqual(CAPI_SENT, [o.order_ref]); assert.deepEqual(LINE_SENT, [o.order_ref]);
  });
  await check('log ไม่มีข้อความ error จากผู้ให้บริการอีเมล/อีเมลลูกค้า', () => {
    assert.ok(!logs.some(l => /provider said|@example/.test(l)), logs.join(' | '));
  });
  const tokenBefore = o.download_token;
  FAULT.email = false;
  r = mockRes(); await webhook(hook('evnt_1', o.omise_charge_id), r);
  await check('Omise retry event เดิม → 200 และส่งอีเมลสำเร็จ 1 ฉบับ', () => {
    assert.equal(r.statusCode, 200); assert.equal(MAILS.length, 1);
  });
  await check('อีเมลใช้ token เดิม ไม่ออกใหม่ทับลิงก์บนหน้าขอบคุณ', () => {
    assert.equal(o.download_token, tokenBefore); assert.equal(MAILS[0].payload.html, 'token=' + tokenBefore);
  });
  await check('รอบ retry ไม่ส่ง CAPI/LINE ซ้ำ', () => {
    assert.equal(CAPI_SENT.length, 1); assert.equal(LINE_SENT.length, 1);
  });
  r = mockRes(); await webhook(hook('evnt_1', o.omise_charge_id), r);
  await check('ครั้งที่สามหลังสำเร็จ → duplicate 200 ไม่ส่งอีเมลซ้ำ', () => {
    assert.equal(r.statusCode, 200); assert.equal(r.body.duplicate, true); assert.equal(MAILS.length, 1);
  });

  /* ---------------- PAY-02 ---------------- */
  section('PAY-02 DB ล้มตอนอัปเดตออเดอร์ → ห้ามตอบ 200');
  reset(); o = seed();
  FAULT.ordersPatch = true;
  r = mockRes(); await webhook(hook('evnt_2', o.omise_charge_id), r);
  await check('ตอบ 500 (เดิมตอบ 200 ทั้งที่ออเดอร์ค้าง pending)', () => assert.equal(r.statusCode, 500));
  await check('ออเดอร์ยัง pending และลบแถวกันซ้ำแล้ว', () => {
    assert.equal(o.status, 'pending'); assert.equal(S.webhook_events.length, 0);
  });
  FAULT.ordersPatch = false;
  r = mockRes(); await webhook(hook('evnt_2', o.omise_charge_id), r);
  await check('Omise retry หลัง DB กลับมา → paid + ส่งอีเมล + CAPI ครั้งเดียว', () => {
    assert.equal(r.statusCode, 200); assert.equal(o.status, 'paid');
    assert.equal(MAILS.length, 1); assert.deepEqual(CAPI_SENT, [o.order_ref]);
  });

  reset(); o = seed();
  FAULT.ordersPatch = true;
  const ordersLib = require(path.join(REPO, 'api', '_lib', 'orders.js'));
  await check('applyChargeResult โยน error เมื่อ UPDATE ล้ม (เดิมคืนเหมือนไม่มีอะไรเปลี่ยน)', async () => {
    await assert.rejects(ordersLib.applyChargeResult(CHARGES[o.omise_charge_id]), /order_update_failed/);
  });

  reset(); o = seed();
  FAULT.ordersPatch = true; FAULT.webhookDelete = true;
  r = mockRes(); await webhook(hook('evnt_3', o.omise_charge_id), r);
  await check('ลบแถวกันซ้ำไม่ได้ก็ยังตอบ 500 ไม่ throw (cron เป็นด่านสุดท้าย)', () => assert.equal(r.statusCode, 500));

  /* ---------------- PAY-04 ---------------- */
  section('PAY-04 paid แล้วแต่ยังไม่ได้ส่งของ (เช่น create-charge ถูกตัดกลางคัน)');
  reset(); o = seed({ status: 'paid', paid_at: new Date().toISOString() });
  r = mockRes(); await webhook(hook('evnt_4', o.omise_charge_id), r);
  await check('event ถัดไปของ charge นี้ส่งมอบให้ (เดิมข้ามเพราะสถานะไม่เปลี่ยน)', () => {
    assert.equal(r.statusCode, 200); assert.equal(MAILS.length, 1); assert.ok(o.download_token);
  });
  await check('ไม่ส่ง CAPI/LINE เพราะไม่ใช่รอบที่เปลี่ยนเป็น paid', () => {
    assert.equal(CAPI_SENT.length, 0); assert.equal(LINE_SENT.length, 0);
  });
  r = mockRes(); await webhook(hook('evnt_5', o.omise_charge_id), r);
  await check('event อื่นของ charge เดิม → ไม่ส่งอีเมลซ้ำ', () => {
    assert.equal(r.statusCode, 200); assert.equal(MAILS.length, 1);
  });
  reset(); o = seed({ status: 'refunded', paid_at: new Date().toISOString() });
  r = mockRes(); await webhook(hook('evnt_6', o.omise_charge_id), r);
  await check('ออเดอร์ที่คืนเงินแล้ว → ไม่ส่งของ', () => {
    assert.equal(r.statusCode, 200); assert.equal(MAILS.length, 0);
  });

  /* ---------------- cron reconcile ---------------- */
  section('cron รายวันไล่ซ่อมออเดอร์ 7 วันล่าสุด');
  reset();
  const stuck = seed();                                                       // จ่ายแล้วแต่ webhook ไม่มา
  const unpaid = seed(); CHARGES[unpaid.omise_charge_id].status = 'pending';  // ยังไม่ได้จ่าย
  const noMail = seed({ status: 'paid', paid_at: new Date().toISOString() });
  const mailed = seed({ status: 'paid', paid_at: new Date().toISOString() });
  S.email_events.push({ order_id: mailed.id, kind: 'purchase', status: 'sent' });
  const old = seed({ status: 'paid', paid_at: new Date(Date.now() - 8 * DAY).toISOString(),
                     created_at: new Date(Date.now() - 8 * DAY).toISOString() });
  r = mockRes();
  await cron({ method: 'GET', url: '/', headers: { authorization: 'Bearer cron-secret-fixture' } }, r);
  const sentTo = MAILS.map(m => m.to);
  await check('ตอบ 200 และรายงานผล reconcile', () => {
    assert.equal(r.statusCode, 200); assert.ok(r.body.reconcile, JSON.stringify(r.body));
  });
  await check('pending ที่ Omise บอกว่าจ่ายแล้ว → paid + ส่งอีเมล + CAPI', () => {
    assert.equal(stuck.status, 'paid'); assert.deepEqual(CAPI_SENT, [stuck.order_ref]);
  });
  await check('pending ที่ยังไม่จ่ายจริง → ไม่แตะ', () => assert.equal(unpaid.status, 'pending'));
  await check('ส่งอีเมลเฉพาะออเดอร์ที่ยังไม่เคยได้ (2 ฉบับ)', () => {
    assert.equal(MAILS.length, 2, JSON.stringify(sentTo));
    assert.equal(S.email_events.filter(e => e.order_id === mailed.id).length, 1);
    assert.equal(S.email_events.filter(e => e.order_id === old.id).length, 0);
    assert.ok(S.email_events.some(e => e.order_id === noMail.id && e.status === 'sent'));
  });
  await check('รายงานตัวเลขถูก', () => {
    assert.deepEqual(r.body.reconcile, { pending_checked: 2, marked_paid: 1, delivered: 2, failed: 0 });
  });
  r = mockRes();
  await cron({ method: 'GET', url: '/', headers: { authorization: 'Bearer cron-secret-fixture' } }, r);
  await check('รันซ้ำวันถัดไป → ไม่ส่งอะไรซ้ำ', () => {
    assert.equal(MAILS.length, 2); assert.equal(r.body.reconcile.delivered, 0);
  });
  r = mockRes();
  await cron({ method: 'GET', url: '/', headers: { authorization: 'Bearer wrong' } }, r);
  await check('secret ผิด → 401 ไม่ทำอะไร', () => assert.equal(r.statusCode, 401));

  /* ---------------- PAY-03 ---------------- */
  section('PAY-03 ชั้นหนังสือ: อีเมลตอนซื้อมีตัวพิมพ์ใหญ่');
  reset();
  S.user_sessions.push({ id: 's1', email: 'my_name@example.com', session_token: 'sess-1',
                         expires_at: new Date(Date.now() + DAY).toISOString() });
  const mixed = seed({ status: 'paid', customer_email: 'My_Name@Example.com', reader_token: null });
  const decoy = seed({ status: 'paid', customer_email: 'myXname@example.com', reader_token: 'rt-decoy' });
  const lib = async () => {
    const res = mockRes();
    await auth({ method: 'GET', url: '/', query: { action: 'my-library' }, headers: { cookie: 'vnk_sid=sess-1' } }, res);
    return res;
  };
  r = await lib();
  await check('เจอหนังสือจากออเดอร์ My_Name@Example.com', () => {
    assert.equal(r.statusCode, 200); assert.equal(r.body.books.length, 1, JSON.stringify(r.body));
  });
  await check('_ ในอีเมลไม่กลายเป็น wildcard — ไม่ดึงออเดอร์ myXname มาด้วย', () => {
    assert.ok(!r.body.books.some(b => b.reader_token === 'rt-decoy'));
    assert.ok(SEEN_QUERIES.some(q => /customer_email=ilike\.my%5C_name%40example\.com/.test(q)), SEEN_QUERIES.join('\n'));
  });
  await check('ออเดอร์ที่ไม่มี reader_token ถูกออกให้ เปิดอ่านได้', () => {
    assert.ok(mixed.reader_token); assert.equal(r.body.books[0].reader_token, mixed.reader_token);
  });
  const rt = mixed.reader_token;
  r = await lib();
  await check('เปิดซ้ำได้ reader_token เดิม', () => assert.equal(r.body.books[0].reader_token, rt));
  void decoy;

  /* ---------------- reader token race ---------------- */
  section('reader_token: สองทางออกพร้อมกันต้องได้ค่าเดียว');
  reset(); o = seed({ status: 'paid' });
  const [a, b] = await Promise.all([tokens.issueReaderToken(o.id), tokens.issueReaderToken(o.id)]);
  await check('ทั้งสองทางได้ token ตัวเดียวกับที่บันทึก', () => {
    assert.equal(a, o.reader_token); assert.equal(b, o.reader_token);
  });

  /* ---------------- download streaming ---------------- */
  section('ดาวน์โหลด PDF ใหญ่ — ทยอยเขียน ไม่ส่งก้อนเดียว');
  const BIG = 2.5 * 1024 * 1024;
  stub('_lib/storage.js', { download: async () => Buffer.from('%PDF-master'), exists: async () => true });
  stub('_lib/watermark.js', {
    stamp: async () => ({ bytes: new Uint8Array(BIG).fill(7) }),
    safeFilename: () => 'WOW-LAB.pdf', contentDisposition: f => 'attachment; filename="' + f + '"'
  });
  const download = require(path.join(REPO, 'api', 'download.js'));
  reset(); o = seed({ status: 'paid' });
  const dlToken = await tokens.issue(o.id);
  r = mockRes();
  await download({ method: 'GET', url: '/api/download?token=' + dlToken + '&item=it-1', headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} }, r);
  const total = Buffer.concat(r.chunks);
  await check('ตอบ 200 แบบ PDF', () => {
    assert.equal(r.statusCode, 200); assert.equal(r.headers['content-type'], 'application/pdf');
  });
  await check('ไฟล์ 2.5 MB ถูกเขียน 3 ก้อน ก้อนละไม่เกิน 1 MB แล้วปิด', () => {
    assert.equal(r.writes, 3); assert.ok(r.chunks.every(c => c.length <= 1024 * 1024)); assert.ok(r.ended);
  });
  await check('ได้ไฟล์ครบทุกไบต์ ตรงกับ Content-Length', () => {
    assert.equal(total.length, BIG); assert.equal(r.headers['content-length'], String(BIG));
  });

  console.error = origErr; console.warn = origWarn;
  finished = true;
  console.log('\nDelivery hardening: ' + passed + ' passed, ' + failed + ' failed (no network)');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error = origErr; console.error(e); process.exitCode = 1; });
