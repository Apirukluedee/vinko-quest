/* ============================================================
   ชุดตรวจ Meta Pixel + Conversions API

   รันด้วย:  node tests/meta-capi-checks.js
   ไม่ต้องมี key จริง ไม่ยิงเครือข่าย — fetch ถูก stub ทั้งหมด
   (Supabase, Omise, graph.facebook.com) site.js/thank-you.js รันใน VM

   ครอบคลุม:
   1. normalize + hash อีเมล/เบอร์ตามกติกา Meta, fbc เฉพาะ click id ของ meta
   2. consent: ส่งเฉพาะ attribution_status = captured
   3. ไม่มี token = ไม่ส่ง เตือนครั้งเดียว; charge ทดสอบไม่ส่ง
   4. payload: event_id = order_ref, ยอดจาก DB, ไม่มีอีเมลดิบ, token ไม่อยู่ใน URL
   5. CAPI พัง (4xx / throw / timeout) ไม่ throw และ log แค่ status/code
   6. webhook + create-charge (บัตรผ่านทันที): CAPI พังแล้วออเดอร์ยัง paid ส่งมอบครบ
   7. เบราว์เซอร์: Pixel หลัง consent, Purchase eventID = order_ref, guard live/test
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}
function section(t) { console.log('\n' + t); }
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

process.env.OMISE_SECRET_KEY = 'skey_test_FAKE';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_FAKE';
process.env.APP_BASE_URL = 'https://vinko.example';
process.env.IP_HASH_SALT = 'test-salt';
const TOKEN = 'EAAG_FAKE_TOKEN_DO_NOT_LOG';
const EMAIL = 'Parent.Test@Example.COM';
const PHONE = '081-234-5678';
const REF = 'VK-2609-0042';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

/* ---------------- mock เครือข่าย ---------------- */
const SB = 'https://fake.supabase.co/rest/v1';
const GRAPH = 'https://graph.facebook.com/';
const S = { orders: [], order_items: [], webhook_events: [], counter: 0, graph: [], graphReply: null, charge: null, stallCapiRead: false };
const reply = (status, body, headers) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (headers || {})[k.toLowerCase()] || null },
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
  json: async () => body
});

global.fetch = async function (url, opts) {
  opts = opts || {};
  const u = String(url), method = (opts.method || 'GET').toUpperCase();
  if (u.startsWith(GRAPH)) {
    S.graph.push({ url: u, body: JSON.parse(opts.body), signal: opts.signal });
    if (S.graphReply) return S.graphReply(opts);
    return reply(200, { events_received: 1 });
  }
  if (u.startsWith(SB)) {
    const [p, qs] = u.slice(SB.length).split('?');
    if (p === '/rpc/next_order_ref') return reply(200, 'VK-2609-' + String(++S.counter).padStart(4, '0'));
    const table = p.slice(1);
    const filters = [...new URLSearchParams(qs || '')].filter(([k]) => !['select', 'limit', 'order'].includes(k))
      .map(([k, v]) => [k, v.replace(/^(eq|gte)\./, ''), v.startsWith('gte.')]);
    const match = r => filters.every(([k, v, gte]) => gte ? new Date(r[k]) >= new Date(v) : String(r[k]) === v);
    if (method === 'HEAD') return reply(200, undefined, { 'content-range': '0-0/' + S[table].filter(match).length });
    // (mock ไม่ได้เรียงตาม order= เทสต์จึงเทียบแบบ sort)
    // จำลอง Supabase ค้าง เฉพาะตอน meta-capi อ่านออเดอร์ (select มี customer_phone)
    // การอ่านของ webhook / create-charge เองยังทำงานปกติ
    if (method === 'GET' && S.stallCapiRead && table === 'orders' && /customer_phone/.test(qs || '')) return new Promise(() => {});
    if (method === 'GET') return reply(200, S[table].filter(match));
    if (method === 'POST') {
      const rows = [].concat(JSON.parse(opts.body));
      // จำลองฐานข้อมูลที่ยังไม่ได้รัน migration (เช่น 009) — PostgREST ปฏิเสธก่อนบันทึก
      const miss = table === 'orders' && (S.missingColumns || []).find(c => c in rows[0]);
      if (miss) return reply(400, { code: 'PGRST204', message: "Could not find the '" + miss + "' column of 'orders' in the schema cache" });
      if (table === 'webhook_events' && S.webhook_events.some(e => e.omise_event_id === rows[0].omise_event_id)) {
        return reply(409, { code: '23505', message: 'duplicate key' });
      }
      const created = rows.map((r, i) => Object.assign({ id: table + '-' + (S[table].length + i + 1), created_at: new Date().toISOString() }, r));
      S[table].push(...created);
      return reply(201, created);
    }
    if (method === 'PATCH') {
      const hit = S[table].filter(match); hit.forEach(r => Object.assign(r, JSON.parse(opts.body)));
      return reply(200, hit);
    }
    if (method === 'DELETE') {
      S[table] = S[table].filter(r => !match(r));
      return reply(204, undefined);
    }
  }
  if (u.startsWith('https://api.omise.co')) {
    const p = u.slice('https://api.omise.co'.length);
    const b = Object.fromEntries(new URLSearchParams(opts.body || ''));
    if (method === 'GET' && p.startsWith('/charges/')) return reply(200, S.charge);
    if (method === 'POST' && p === '/charges') {
      // บัตรผ่านทันที (ไม่ต้อง 3DS) — livemode true เหมือน production
      S.charge = { object: 'charge', id: 'chrg_live_' + S.counter, status: 'successful', paid: true, livemode: true,
        amount: Number(b.amount), currency: 'thb', card: { brand: 'Visa' }, metadata: {} };
      return reply(200, S.charge);
    }
  }
  throw new Error('unmocked fetch: ' + method + ' ' + u);
};

function reset() {
  Object.assign(S, { orders: [], order_items: [], webhook_events: [], counter: 0, graph: [], graphReply: null, charge: null, stallCapiRead: false, missingColumns: [] });
}
function seedOrder(extra) {
  const o = Object.assign({
    id: 'orders-1', order_ref: REF, status: 'paid', package_code: 'STORIES', amount_satang: 19900, currency: 'THB',
    customer_name: 'ผู้ปกครอง ทดสอบ', customer_email: EMAIL, customer_phone: PHONE,
    omise_charge_id: 'chrg_live_1', attribution_status: 'captured', client_user_agent: UA,
    attribution_snapshot: { first: { utm_source: 'facebook', t: '2026-09-27T08:00:00.000Z' },
      last: { utm_source: 'facebook', click_id_platform: 'meta', click_id_value: 'IwAR0abcDEF', t: '2026-09-28T09:00:00.000Z' },
      captured_at: '2026-09-28T10:00:00.000Z', schema_version: 1 }
  }, extra);
  S.orders.push(o);
  return o;
}
const liveCharge = { object: 'charge', id: 'chrg_live_1', livemode: true, status: 'successful' };

// โหลด module ใหม่ทุกครั้ง (ธง "เตือนแล้ว" ของ token อยู่ระดับ module)
function fresh(rel) {
  for (const f of ['_lib/meta-capi.js', '_lib/supabase.js', '_lib/orders.js', 'omise-webhook.js', 'create-charge.js']) {
    delete require.cache[require.resolve(path.join(REPO, 'api', f))];
  }
  return require(path.join(REPO, 'api', rel));
}
// แทน deliver-order / line ด้วยตัวปลอม — ส่งอีเมลจริงไม่ใช่เรื่องของชุดนี้
const calls = { deliver: [], line: [] };
let deliverImpl = async ref => ({ ok: true });
function stub(rel, exports) {
  const p = require.resolve(path.join(REPO, 'api', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('_lib/deliver-order.js', { deliver: async ref => { calls.deliver.push(ref); return deliverImpl(ref); } });
stub('_lib/line.js', { notifyOrder: async ref => { calls.line.push(ref); } });

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r; };
  return r;
}

const logs = [];
// log ของโค้ดที่ทดสอบเท่านั้น (config.js เตือนเรื่องรูปแบบ key ปลอมของเทสต์เอง ไม่นับ)
const capiLogs = () => logs.filter(l => l.includes('[vinko][meta-capi]'));
const orig = { error: console.error, warn: console.warn, log: console.log };
function captureLogs() {
  logs.length = 0;
  console.error = (...a) => logs.push('E ' + a.join(' '));
  console.warn = (...a) => logs.push('W ' + a.join(' '));
  // console.log ของโค้ดที่ทดสอบ (CAPI_SENT / CAPI_SKIPPED) — บรรทัด PASS ของเทสต์ยังพิมพ์ปกติ
  console.log = (...a) => { const t = a.join(' '); if (t.startsWith('[vinko]')) logs.push('L ' + t); else orig.log(...a); };
}
function restoreLogs() { console.error = orig.error; console.warn = orig.warn; console.log = orig.log; }
function assertNoLeak() {
  const all = logs.join('\n');
  for (const bad of [EMAIL, EMAIL.toLowerCase(), '0812345678', '66812345678', sha('parent.test@example.com'), TOKEN, 'IwAR0abcDEF']) {
    assert.ok(!all.includes(bad), 'log leaked: ' + bad);
  }
}

let customPurchase = null;
// promise ที่ค้างตลอดกาล (เช่น timeout ถูกถอดออก) ทำให้ node ออกเงียบๆ ด้วย exit 0
// ต้องนับเป็นล้ม ไม่งั้น test:all จะผ่านทั้งที่ชุดนี้ไม่ได้รันจบ
let finished = false;
process.on('exit', () => {
  if (!finished) { console.log('\nFAIL  ชุดทดสอบไม่จบ (มี promise ค้าง) — ' + passed + ' passed ก่อนค้าง'); process.exitCode = 1; }
});
(async function run() {
  /* ---------------- 1. normalize + hash ---------------- */
  section('1. normalize + hash ตามกติกา Meta');
  const capi = fresh('_lib/meta-capi.js');

  await check('อีเมล: trim + lowercase แล้ว SHA-256 hex', () => {
    assert.equal(capi.normalizeEmail('  Test@Example.COM '), 'test@example.com');
    // ค่าอ้างอิงคำนวณแยกจากโค้ดที่ทดสอบ
    assert.equal(capi.sha256('test@example.com'), '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b');
    assert.equal(capi.normalizeEmail('not-an-email'), null);
    assert.equal(capi.normalizeEmail(undefined), null);
  });
  await check('เบอร์ไทย: เหลือแต่ตัวเลข ใส่ 66 ตัด 0 นำหน้า', () => {
    for (const v of ['081-234-5678', '0812345678', '+66 81 234 5678', '+66812345678', '+66 081 234 5678', '(081) 234 5678']) {
      assert.equal(capi.normalizePhone(v), '66812345678', v);
    }
    assert.equal(capi.normalizePhone('02-123-4567'), '6621234567');
  });
  await check('เบอร์ที่ไม่รู้จัก / สั้นไป / ต่างประเทศ -> ไม่ส่ง (ไม่เดารหัสประเทศ)', () => {
    for (const v of ['123', '', '+1 415 555 0100', '0012345678', null, 812345678]) assert.equal(capi.normalizePhone(v), null, String(v));
  });
  await check('fbc: เฉพาะ click_id_platform = meta, รูปแบบ fb.1.<ms>.<fbclid>, last ก่อน first', () => {
    const t = '2026-09-28T09:00:00.000Z';
    assert.equal(capi.buildFbc({ last: { click_id_platform: 'meta', click_id_value: 'IwAR0x', t } }), 'fb.1.' + Date.parse(t) + '.IwAR0x');
    assert.equal(capi.buildFbc({ first: { click_id_platform: 'meta', click_id_value: 'IwAR0first', t },
      last: { click_id_platform: 'google', click_id_value: 'gclidX', t } }), 'fb.1.' + Date.parse(t) + '.IwAR0first');
    assert.equal(capi.buildFbc({ last: { click_id_platform: 'google', click_id_value: 'gclidX', t } }), null);
    assert.equal(capi.buildFbc({ last: { click_id_platform: 'tiktok', click_id_value: 'tt', t } }), null);
    assert.equal(capi.buildFbc({ last: { utm_source: 'facebook', t } }), null);
    assert.equal(capi.buildFbc(null), null);
    // ไม่มี t -> ใช้ captured_at
    assert.equal(capi.buildFbc({ last: { click_id_platform: 'meta', click_id_value: 'IwAR0y' }, captured_at: t }), 'fb.1.' + Date.parse(t) + '.IwAR0y');
  });
  await check('payload: ยอดเป็นบาทจากสตางค์ใน DB, THB, website, ไม่มีอีเมล/เบอร์ดิบ', () => {
    const ev = capi.buildPurchaseEvent(seedOrder(), { baseUrl: 'https://vinko.quest', nowMs: Date.parse('2026-09-28T10:00:00Z') });
    reset();
    assert.equal(ev.event_name, 'Purchase');
    assert.equal(ev.event_id, REF);
    assert.equal(ev.action_source, 'website');
    assert.equal(ev.event_source_url, 'https://vinko.quest/thank-you');
    assert.equal(ev.event_time, Math.floor(Date.parse('2026-09-28T10:00:00Z') / 1000));
    assert.deepEqual(ev.custom_data, { value: 199, currency: 'THB', order_id: REF, content_ids: ['STORIES'], content_type: 'product' });
    assert.deepEqual(ev.user_data.em, [sha('parent.test@example.com')]);
    assert.deepEqual(ev.user_data.ph, [sha('66812345678')]);
    assert.match(ev.user_data.fbc, /^fb\.1\.\d{13}\.IwAR0abcDEF$/);
    const raw = JSON.stringify(ev);
    assert.ok(!raw.includes('@') && !raw.includes('0812345678') && !raw.includes('ผู้ปกครอง'));
  });
  await check('ยอดผิดรูปแบบ / สกุลเงินอื่น -> ไม่สร้าง event', () => {
    for (const bad of [{ amount_satang: 0 }, { amount_satang: 199.5 }, { amount_satang: '19900' }, { currency: 'USD' }]) {
      assert.equal(capi.buildPurchaseEvent(Object.assign(seedOrder(), bad), {}), null, JSON.stringify(bad));
      reset();
    }
  });
  await check('pixel ID ฝั่ง server ตรงกับ config.js ฝั่งเบราว์เซอร์', () => {
    const src = fs.readFileSync(path.join(REPO, 'assets/js/config.js'), 'utf8');
    const m = src.match(/META_PIXEL_ID:\s*"(\d+)"/);
    assert.ok(m, 'META_PIXEL_ID not found in config.js');
    assert.equal(m[1], capi.PIXEL_ID);
    assert.equal(capi.PIXEL_ID, '1366170372169518');
  });

  /* ---------------- 2-5. sendPurchase ---------------- */
  section('2. consent gating');
  process.env.META_CAPI_ACCESS_TOKEN = TOKEN;
  delete process.env.META_TEST_EVENT_CODE;
  captureLogs();
  try {
    for (const st of ['no_consent', null, 'none', 'erased', 'CAPTURED', '']) {
      reset();
      seedOrder({ attribution_status: st, attribution_snapshot: null });
      const r = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
      await check('attribution_status = ' + JSON.stringify(st) + ' -> ไม่ส่ง', () => {
        assert.equal(S.graph.length, 0);
        assert.deepEqual(r, { sent: false, reason: 'no_consent' });
      });
    }
    reset(); seedOrder();
    let r = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('captured -> ส่ง 1 ครั้ง', () => { assert.deepEqual(r, { sent: true }); assert.equal(S.graph.length, 1); });
    await check('ส่งไป dataset ที่ถูก, token อยู่ใน body ไม่ใช่ URL, event_id = order_ref', () => {
      const g = S.graph[0];
      assert.match(g.url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/1366170372169518\/events$/);
      assert.ok(!g.url.includes(TOKEN));
      assert.equal(g.body.access_token, TOKEN);
      assert.equal(g.body.data.length, 1);
      assert.equal(g.body.data[0].event_id, REF);
      assert.equal(g.body.data[0].custom_data.value, 199);
      assert.equal(g.body.test_event_code, undefined);
      assert.ok(!JSON.stringify(g.body.data).includes('parent.test@example.com'));
    });
    reset(); seedOrder({ status: 'pending' });
    r = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('ออเดอร์ยังไม่ paid -> ไม่ส่ง', () => { assert.equal(S.graph.length, 0); assert.equal(r.reason, 'not_paid'); });

    section('3. token / live-test guard');
    reset(); seedOrder(); delete process.env.META_CAPI_ACCESS_TOKEN; logs.length = 0;
    const noTok = fresh('_lib/meta-capi.js');
    const a = await noTok.sendPurchase(REF, liveCharge);
    const b = await noTok.sendPurchase(REF, liveCharge);
    await check('ไม่มี META_CAPI_ACCESS_TOKEN -> ไม่ส่ง ไม่แตะ DB เตือนครั้งเดียว', () => {
      assert.equal(a.reason, 'no_token'); assert.equal(b.reason, 'no_token');
      assert.equal(S.graph.length, 0);
      const warns = logs.filter(l => l.includes('META_CAPI_ACCESS_TOKEN'));
      assert.equal(warns.length, 1);
      assert.equal(capiLogs().length, 1);
    });
    process.env.META_CAPI_ACCESS_TOKEN = '   ';
    const blank = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('token เป็นช่องว่าง = ไม่มี token', () => { assert.equal(blank.reason, 'no_token'); assert.equal(S.graph.length, 0); });
    process.env.META_CAPI_ACCESS_TOKEN = TOKEN;

    reset(); seedOrder();
    for (const ch of [{ id: 'c', livemode: false }, { id: 'c' }, null]) {
      const x = await fresh('_lib/meta-capi.js').sendPurchase(REF, ch);
      await check('charge livemode = ' + JSON.stringify(ch && ch.livemode) + ' -> ไม่ส่ง (guard เดียวกับ GA4)', () => {
        assert.equal(x.reason, 'not_live'); assert.equal(S.graph.length, 0);
      });
    }
    process.env.META_TEST_EVENT_CODE = 'TEST12345';
    for (const ch of [{ id: 'c', livemode: false }, { id: 'c' }]) {
      const x = await fresh('_lib/meta-capi.js').sendPurchase(REF, ch);
      await check('META_TEST_EVENT_CODE ตั้งไว้ + livemode ' + JSON.stringify(ch.livemode) + ' -> ยังไม่ส่ง (test code ไม่ปลดล็อก charge ทดสอบ)', () => {
        assert.equal(x.reason, 'not_live'); assert.equal(S.graph.length, 0);
      });
    }
    logs.length = 0;
    const tm = fresh('_lib/meta-capi.js');
    const t1 = await tm.sendPurchase(REF, liveCharge);
    const t2 = await tm.sendPurchase(REF, liveCharge);
    await check('META_TEST_EVENT_CODE ตั้งไว้ + charge จริง -> ส่งไป Test Events และเตือนทุกครั้งที่ส่ง', () => {
      assert.deepEqual(t1, { sent: true }); assert.deepEqual(t2, { sent: true });
      assert.equal(S.graph.length, 2);
      assert.equal(S.graph[0].body.test_event_code, 'TEST12345');
      const warns = capiLogs().filter(l => l === 'W [vinko][meta-capi] CAPI test mode ON — remove META_TEST_EVENT_CODE after testing');
      assert.equal(warns.length, 2);
      assert.ok(!logs.join(' ').includes('TEST12345'), 'test code value logged');
    });
    delete process.env.META_TEST_EVENT_CODE;
    reset(); seedOrder(); logs.length = 0;
    await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('ไม่ได้ตั้ง test code -> ไม่มี test_event_code และไม่มีคำเตือน test mode', () => {
      assert.equal(S.graph[0].body.test_event_code, undefined);
      assert.equal(capiLogs().filter(l => l.includes('test mode')).length, 0);
    });

    section('4. CAPI พัง -> ไม่ throw, log แค่ status/code');
    reset(); seedOrder(); logs.length = 0;
    S.graphReply = () => reply(400, { error: { message: 'Invalid parameter for ' + EMAIL + ' token ' + TOKEN, type: 'OAuthException', code: 100, fbtrace_id: 'x' } });
    let f = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('Graph 400 -> {sent:false} + log "status: 400 code: 100" ไม่มีข้อความจาก Meta', () => {
      assert.deepEqual(f, { sent: false, reason: 'http' });
      assert.deepEqual(capiLogs(), ['E [vinko][meta-capi] CAPI_FAILED status: 400 code: 100']);
      assertNoLeak();
    });
    reset(); seedOrder(); logs.length = 0;
    S.graphReply = () => { throw new TypeError('fetch failed for ' + EMAIL); };
    f = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('network throw -> ไม่ throw, log แค่ชื่อ error', () => {
      assert.deepEqual(f, { sent: false, reason: 'error' });
      assert.deepEqual(capiLogs(), ['E [vinko][meta-capi] CAPI_FAILED status: - code: TypeError']);
      assertNoLeak();
    });
    reset(); seedOrder(); logs.length = 0;
    S.graphReply = opts => new Promise((_, rej) => opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
    }));
    const t0 = Date.now();
    f = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    const took = Date.now() - t0;
    await check('Graph ไม่ตอบ -> ตัดที่ timeout (' + capi.TIMEOUT_MS + 'ms) ไม่ค้าง, took ' + took + 'ms', () => {
      assert.deepEqual(f, { sent: false, reason: 'timeout' });
      assert.ok(took >= capi.TIMEOUT_MS - 50 && took < capi.TIMEOUT_MS + 500, 'took ' + took);
      assert.deepEqual(capiLogs(), ['E [vinko][meta-capi] CAPI_FAILED status: - code: TIMEOUT']);
    });
    reset(); seedOrder(); logs.length = 0; S.stallCapiRead = true;
    let t0s = Date.now();
    f = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    let tookS = Date.now() - t0s;
    await check('Supabase ค้างตอนอ่านออเดอร์ -> ทิ้งงานที่ timeout รวม ไม่เรียก Meta, took ' + tookS + 'ms', () => {
      assert.deepEqual(f, { sent: false, reason: 'timeout' });
      assert.ok(tookS < capi.TIMEOUT_MS + 500, 'took ' + tookS);
      assert.equal(S.graph.length, 0);
      assert.deepEqual(capiLogs(), ['E [vinko][meta-capi] CAPI_FAILED status: - code: TIMEOUT']);
    });
    reset(); seedOrder(); logs.length = 0;
    S.graphReply = () => reply(500, 'not json');
    f = await fresh('_lib/meta-capi.js').sendPurchase(REF, liveCharge);
    await check('Graph 500 body ไม่ใช่ JSON -> code: -', () => {
      assert.deepEqual(capiLogs(), ['E [vinko][meta-capi] CAPI_FAILED status: 500 code: -']);
    });

    /* ---------------- 6. ผูกกับ flow จริง ---------------- */
    section('5. webhook: CAPI ไม่กระทบสถานะ/การส่งมอบ');
    async function webhook(eventId) {
      const res = mockRes();
      await fresh('omise-webhook.js')({ method: 'POST', headers: {},
        body: { id: eventId, key: 'charge.complete', data: { object: 'charge', id: 'chrg_live_1' } } }, res);
      return res;
    }
    reset(); calls.deliver = []; calls.line = []; logs.length = 0;
    seedOrder({ status: 'pending', paid_at: null });
    S.charge = { object: 'charge', id: 'chrg_live_1', status: 'successful', paid: true, livemode: true, amount: 19900, currency: 'thb', card: {} };
    S.graphReply = () => { throw new TypeError('fetch failed'); };
    let w = await webhook('evnt_1');
    await check('Graph พัง -> webhook ตอบ 200, ออเดอร์ paid, deliver + LINE ถูกเรียก', () => {
      assert.equal(w.statusCode, 200, JSON.stringify(w.body));
      assert.equal(S.orders[0].status, 'paid');
      assert.deepEqual(calls.deliver, [REF]);
      assert.deepEqual(calls.line, [REF]);
      assert.equal(S.graph.length, 1);
      assert.equal(S.webhook_events.length, 1);   // ส่งมอบสำเร็จ: เก็บแถวกันซ้ำไว้
      assertNoLeak();
    });
    S.graphReply = null;
    w = await webhook('evnt_2');
    await check('webhook ซ้ำหลัง paid แล้ว -> ไม่ส่ง CAPI ซ้ำ', () => {
      assert.equal(w.statusCode, 200);
      assert.equal(S.graph.length, 1);
    });
    reset(); calls.deliver = []; seedOrder({ status: 'pending' });
    S.charge = { object: 'charge', id: 'chrg_live_1', status: 'successful', paid: true, livemode: true, amount: 19900, currency: 'thb', card: {} };
    w = await webhook('evnt_3');
    await check('webhook สำเร็จ -> ส่ง CAPI 1 ครั้ง event_id = order_ref หลัง deliver', () => {
      assert.equal(w.statusCode, 200);
      assert.equal(S.graph.length, 1);
      assert.equal(S.graph[0].body.data[0].event_id, REF);
    });
    reset(); calls.deliver = []; seedOrder({ status: 'pending' });
    S.charge = { object: 'charge', id: 'chrg_live_1', status: 'successful', paid: true, livemode: true, amount: 19900, currency: 'thb', card: {} };
    deliverImpl = async () => { throw new Error('resend down'); };
    w = await webhook('evnt_4');
    deliverImpl = async () => ({ ok: true });
    await check('deliver พัง -> ยังตอบ 500 ให้ Omise retry (ลบแถวกันซ้ำ) และ CAPI ถูกส่งครั้งเดียว', () => {
      assert.equal(w.statusCode, 500);
      assert.equal(S.webhook_events.length, 0);   // ส่งมอบล้ม: ลบแถวกันซ้ำ ให้ Omise retry ทำใหม่ได้
      assert.equal(S.graph.length, 1);
    });
    reset(); calls.deliver = []; seedOrder({ status: 'pending', attribution_status: 'no_consent', attribution_snapshot: null });
    S.charge = { object: 'charge', id: 'chrg_live_1', status: 'successful', paid: true, livemode: true, amount: 19900, currency: 'thb', card: {} };
    w = await webhook('evnt_5');
    await check('webhook ออเดอร์ no_consent -> paid + deliver แต่ไม่ส่ง CAPI', () => {
      assert.equal(w.statusCode, 200);
      assert.equal(S.orders[0].status, 'paid');
      assert.deepEqual(calls.deliver, [REF]);
      assert.equal(S.graph.length, 0);
    });

    const BOUND = capi.TIMEOUT_MS + 500;
    const liveCh = () => ({ object: 'charge', id: 'chrg_live_1', status: 'successful', paid: true, livemode: true, amount: 19900, currency: 'thb', card: {} });
    reset(); calls.deliver = []; seedOrder({ status: 'pending' }); S.stallCapiRead = true; S.charge = liveCh();
    t0s = Date.now(); w = await webhook('evnt_6'); tookS = Date.now() - t0s;
    await check('Supabase ค้างตอน CAPI อ่าน -> webhook ยังตอบ 200 ภายใน ' + BOUND + 'ms (took ' + tookS + 'ms), paid + deliver ครบ', () => {
      assert.equal(w.statusCode, 200);
      assert.ok(tookS < BOUND, 'took ' + tookS);
      assert.equal(S.orders[0].status, 'paid');
      assert.deepEqual(calls.deliver, [REF]);
      assert.equal(S.webhook_events.length, 1);   // ส่งมอบสำเร็จ: เก็บแถวกันซ้ำไว้
      assert.equal(S.graph.length, 0);
    });
    reset(); calls.deliver = []; seedOrder({ status: 'pending' }); S.stallCapiRead = true; S.charge = liveCh();
    deliverImpl = async () => { throw new Error('resend down'); };
    t0s = Date.now(); w = await webhook('evnt_7'); tookS = Date.now() - t0s;
    deliverImpl = async () => ({ ok: true });
    await check('Supabase ค้าง + deliver พัง -> ยังตอบ 500 ภายใน ' + BOUND + 'ms (took ' + tookS + 'ms)', () => {
      assert.equal(w.statusCode, 500);
      assert.ok(tookS < BOUND, 'took ' + tookS);
      assert.equal(S.webhook_events.length, 0);   // ส่งมอบล้ม: ลบแถวกันซ้ำ ให้ Omise retry ทำใหม่ได้
    });

    section('6. create-charge บัตรผ่านทันที');
    async function payCard(extra, ua) {
      const res = mockRes();
      await fresh('create-charge.js')({ method: 'POST', url: '/', headers: { 'x-forwarded-for': '9.9.9.' + S.counter, 'user-agent': ua === undefined ? UA : ua }, socket: {},
        body: Object.assign({ customer_name: 'ผู้ปกครอง ทดสอบ', customer_email: EMAIL, customer_phone: PHONE,
          consent_terms: true, consent_privacy: true, package_code: 'LAB', payment_method: 'card', card_token: 'tokn_test_1',
          attribution: { last: { utm_source: 'facebook', click_id_platform: 'meta', click_id_value: 'IwAR0abcDEF', t: new Date(Date.now() - 60000).toISOString() } },
          attribution_consent: true }, extra) }, res);
      return res;
    }
    reset(); calls.deliver = []; logs.length = 0;
    S.graphReply = () => { throw new TypeError('fetch failed'); };
    let c = await payCard();
    await tickFlush();
    await check('Graph พัง -> ลูกค้ายังได้ ok + successful, ออเดอร์ paid, deliver ถูกเรียก', () => {
      assert.equal(c.statusCode, 200, JSON.stringify(c.body));
      assert.equal(c.body.ok, true);
      assert.equal(c.body.charge_status, 'successful');
      assert.equal(S.orders[0].status, 'paid');
      assert.deepEqual(calls.deliver, [S.orders[0].order_ref]);
      assert.equal(S.graph.length, 1);
      assertNoLeak();
    });
    reset(); calls.deliver = []; S.graphReply = null;
    c = await payCard();
    await check('บัตรผ่านทันที -> CAPI 1 ครั้ง event_id = order_ref ที่ตอบลูกค้า, fbc จาก fbclid', () => {
      assert.equal(S.graph.length, 1);
      const ev = S.graph[0].body.data[0];
      assert.equal(ev.event_id, c.body.order_ref);
      assert.equal(ev.custom_data.value, 199);
      assert.match(ev.user_data.fbc, /\.IwAR0abcDEF$/);
    });
    reset(); calls.deliver = [];
    let deliverDone = false;
    deliverImpl = async () => { await new Promise(r => setTimeout(r, 40)); deliverDone = true; return { ok: true, emailed: true }; };
    c = await payCard();
    const doneAtResponse = deliverDone;
    deliverImpl = async () => ({ ok: true });
    await check('บัตรผ่านทันที -> ส่งมอบเสร็จก่อนตอบลูกค้า (Vercel ตัดงานที่ค้างหลังตอบ)', () => {
      assert.equal(c.body.ok, true);
      assert.equal(doneAtResponse, true);
    });
    await check('เก็บอีเมลเป็นตัวพิมพ์เล็ก ชั้นหนังสือ (login ตัวเล็ก) หาออเดอร์เจอ', () => {
      assert.equal(S.orders[0].customer_email, EMAIL.toLowerCase());
    });
    reset(); calls.deliver = [];
    deliverImpl = async () => { throw new Error('resend down'); };
    c = await payCard();
    deliverImpl = async () => ({ ok: true });
    await check('บัตรผ่านทันทีแต่ส่งมอบพัง -> ลูกค้ายังได้ ok (เงินเข้าแล้ว webhook/cron ซ่อมต่อ)', () => {
      assert.equal(c.statusCode, 200);
      assert.equal(c.body.ok, true);
      assert.equal(S.orders[0].status, 'paid');
    });
    reset(); calls.deliver = [];
    c = await payCard({ attribution_consent: false });
    await check('checkout ไม่ยอมรับคุกกี้ -> จ่ายได้ paid แต่ไม่ส่ง CAPI', () => {
      assert.equal(c.body.ok, true);
      assert.equal(S.orders[0].attribution_status, 'no_consent');
      assert.equal(S.orders[0].status, 'paid');
      assert.equal(S.graph.length, 0);
    });
    reset(); calls.deliver = [];
    c = await payCard({ attribution_consent: undefined });
    await check('client ไม่ส่ง flag (status none) -> ไม่ส่ง CAPI', () => {
      assert.equal(S.orders[0].attribution_status, 'none');
      assert.equal(S.graph.length, 0);
    });
    reset(); calls.deliver = []; S.stallCapiRead = true;
    t0s = Date.now(); c = await payCard(); tookS = Date.now() - t0s;
    await check('Supabase ค้างตอน CAPI อ่าน -> ลูกค้าได้คำตอบบัตรภายใน ' + BOUND + 'ms (took ' + tookS + 'ms)', () => {
      assert.equal(c.statusCode, 200);
      assert.equal(c.body.charge_status, 'successful');
      assert.ok(tookS < BOUND, 'took ' + tookS);
      assert.equal(S.orders[0].status, 'paid');
      assert.deepEqual(calls.deliver, [S.orders[0].order_ref]);
    });
    S.stallCapiRead = false;

    reset(); calls.deliver = [];
    c = await payCard({ package_code: undefined, items: ['STORY-03', 'STORY-01'] });
    await check('ตะกร้า /books (CUSTOM) -> CAPI content_ids = เล่มที่ซื้อ, value = ยอดใน DB', () => {
      assert.equal(S.orders[0].package_code, 'CUSTOM');
      const ev = S.graph[0].body.data[0];
      assert.deepEqual([...ev.custom_data.content_ids].sort(), ['STORY-01', 'STORY-03']);
      assert.equal(ev.custom_data.value, S.orders[0].amount_satang / 100);
      assert.equal(ev.event_id, c.body.order_ref);
    });

    /* ---- claim-download: payload purchase ของ CUSTOM ---- */
    /* ---- user agent (migration 009) + log ตอนส่งสำเร็จ / ข้าม ---- */
    section('6a. user agent สำหรับ Meta + log CAPI_SENT / CAPI_SKIPPED');
    reset(); calls.deliver = []; logs.length = 0;
    c = await payCard();
    await check('ออเดอร์ captured -> บันทึก client_user_agent จาก header ตอนกดสั่งซื้อ', () => {
      assert.equal(S.orders[0].attribution_status, 'captured');
      assert.equal(S.orders[0].client_user_agent, UA);
    });
    await check('CAPI ส่ง user_data.client_user_agent (ไม่ hash) ตามข้อกำหนด website event', () => {
      assert.equal(S.graph[0].body.data[0].user_data.client_user_agent, UA);
    });
    await check('ส่งสำเร็จ -> log CAPI_SENT events_received: 1 ไม่มีข้อมูลลูกค้า/เลขออเดอร์/user agent', () => {
      assert.ok(capiLogs().includes('L [vinko][meta-capi] CAPI_SENT events_received: 1'), capiLogs().join(' | '));
      const all = logs.join(' ');
      assert.ok(!all.includes(c.body.order_ref) && !all.includes('iPhone'));
      assertNoLeak();
    });
    reset(); logs.length = 0;
    c = await payCard({ attribution_consent: false });
    await check('ไม่ยอมรับคุกกี้ (no_consent) -> ไม่เก็บ user agent', () => {
      assert.equal(S.orders[0].attribution_status, 'no_consent');
      assert.equal('client_user_agent' in S.orders[0], false);
    });
    await check('ข้ามไม่ส่ง -> log CAPI_SKIPPED reason: no_consent', () => {
      assert.ok(capiLogs().includes('L [vinko][meta-capi] CAPI_SKIPPED reason: no_consent'), capiLogs().join(' | '));
      assert.ok(!logs.join(' ').includes(c.body.order_ref));
    });
    reset();
    c = await payCard({ attribution_consent: undefined });
    await check('status none -> ไม่เก็บ user agent', () => assert.equal('client_user_agent' in S.orders[0], false));
    reset();
    c = await payCard({}, 'Agent\u0000With\u001fControl ' + 'x'.repeat(600));
    await check('user agent: ตัด control char และตัดเหลือ 512 ตัว (ตรง constraint 009)', () => {
      const v = S.orders[0].client_user_agent;
      assert.equal(v.length, 512);
      assert.ok(v.startsWith('AgentWithControl '));
      assert.ok(!/[\u0000-\u001f]/.test(v));
    });
    reset();
    c = await payCard({}, '');
    await check('ไม่มี user agent -> ไม่ใส่คอลัมน์ CAPI ยังส่งได้ และ log บอก (no user agent)', () => {
      assert.equal('client_user_agent' in S.orders[0], false);
      assert.equal(S.graph.length, 1);
      assert.equal(S.graph[0].body.data[0].user_data.client_user_agent, undefined);
    });
    reset(); logs.length = 0; S.missingColumns = ['client_user_agent'];
    c = await payCard();
    await check('ยังไม่ได้รัน 009 -> retry ตัดแค่ user agent: ขายได้ attribution ยังอยู่ log CLIENT_UA_COLUMN_MISSING', () => {
      assert.equal(c.body.ok, true, JSON.stringify(c.body));
      assert.equal(S.orders.length, 1);
      assert.equal(S.orders[0].attribution_status, 'captured');
      assert.equal('client_user_agent' in S.orders[0], false);
      assert.ok(logs.some(l => /CLIENT_UA_COLUMN_MISSING.* status: 400 code: PGRST204 name: client_user_agent$/.test(l)), logs.join(' | '));
      assert.ok(!logs.join(' ').includes('iPhone'));
    });
    reset(); S.missingColumns = ['client_user_agent'];
    c = await payCard({ attribution_consent: false });
    await check('ยังไม่ได้รัน 009 + ออเดอร์ no_consent -> ไม่แตะคอลัมน์นี้เลย ไม่ต้อง retry', () => {
      assert.equal(c.body.ok, true);
      assert.equal(S.orders.length, 1);
    });
    S.missingColumns = [];

    section('6b. claim-download ออเดอร์ CUSTOM มี purchase payload');
    reset(); calls.deliver = [];
    c = await payCard({ package_code: undefined, items: ['STORY-03', 'STORY-01'] });
    // live key จริงของ Omise ไม่มีคำว่า live (skey_xxx) — ใช้รูปแบบเดียวกัน ค่าปลอม
    const LIVE_SHAPED_SK = 'skey_' + 'fixtureNOTREAL0123';
    process.env.OMISE_SECRET_KEY = LIVE_SHAPED_SK;
    const customRef = c.body.order_ref;
    const customOrder = S.orders[0];
    Object.assign(customOrder, { client_request_id: 'rid-custom-0000000001', download_token: 'TOKEN_FIXTURE', token_expires_at: '2027-01-01T00:00:00Z' });
    S.charge = { object: 'charge', id: customOrder.omise_charge_id, status: 'successful', paid: true, livemode: true,
      amount: customOrder.amount_satang, currency: 'thb' };
    const claim = async (ref, rid) => {
      for (const f of ['claim-download.js', '_lib/tokens.js']) delete require.cache[require.resolve(path.join(REPO, 'api', f))];
      const res = mockRes();
      await require(path.join(REPO, 'api', 'claim-download.js'))({ method: 'POST', headers: {}, body: { order_ref: ref, client_request_id: rid } }, res);
      return res;
    };
    const claimRes = await claim(customRef, 'rid-custom-0000000001');
    customPurchase = claimRes.body && claimRes.body.purchase;
    await check('key รูปแบบ live (skey_xxx ไม่มี _test_) -> payment_mode live -> เบราว์เซอร์ได้ payload ยิง purchase ได้', () => {
      assert.ok(customPurchase, 'no purchase payload');
      assert.equal(customPurchase.payment_mode, 'live');
      assert.ok(!JSON.stringify(claimRes.body).includes(LIVE_SHAPED_SK));
    });
    for (const [label, key, want] of [['skey_test_xxx', 'skey_test_' + 'FAKE', 'test'], ['ว่าง/ขยะ', 'garbage', 'unknown']]) {
      process.env.OMISE_SECRET_KEY = key;
      const r2 = await claim(customRef, 'rid-custom-0000000001');
      await check('key ' + label + ' -> payment_mode ' + want, () => assert.equal(r2.body.purchase.payment_mode, want));
    }
    process.env.OMISE_SECRET_KEY = 'skey_test_FAKE';
    await check('CUSTOM -> purchase: transaction_id = order_ref, value = ยอดรวม DB, THB, items จาก order_items', () => {
      assert.equal(claimRes.body.ready, true, JSON.stringify(claimRes.body));
      assert.ok(customPurchase, 'no purchase payload');
      assert.equal(customPurchase.transaction_id, customRef);
      assert.equal(customPurchase.value, customOrder.amount_satang / 100);
      assert.equal(customPurchase.currency, 'THB');
      assert.equal(customPurchase.payment_mode, 'live');
      assert.deepEqual(customPurchase.items.map(i => i.item_id).sort(), ['STORY-01', 'STORY-03']);
      const sum = customPurchase.items.reduce((a, i) => a + i.price * i.quantity, 0);
      assert.equal(Math.round(sum * 100), customOrder.amount_satang);
      assert.ok(customPurchase.items.every(i => typeof i.item_name === 'string' && i.item_name && !/^STORY-/.test(i.item_name)));
    });
    reset();
    seedOrder({ client_request_id: 'rid-pkg-000000000001', download_token: 'T', token_expires_at: '2027-01-01T00:00:00Z' });
    const pkgRes = await claim(REF, 'rid-pkg-000000000001');
    await check('แพ็กเกจเดิม (STORIES) -> purchase เหมือนเดิม + items 1 รายการ', () => {
      const pp = pkgRes.body.purchase;
      assert.equal(pp.transaction_id, REF); assert.equal(pp.value, 199); assert.equal(pp.item_id, 'STORIES');
      assert.deepEqual(pp.items, [{ item_id: 'STORIES', item_name: pp.item_name, price: 199, quantity: 1 }]);
    });
    reset();
    seedOrder({ package_code: 'CUSTOM', client_request_id: 'rid-empty-00000000001', download_token: 'T', token_expires_at: '2027-01-01T00:00:00Z' });
    const emptyRes = await claim(REF, 'rid-empty-00000000001');
    await check('CUSTOM ที่ไม่มี order_items -> ไม่ส่ง purchase แต่ลิงก์ดาวน์โหลดยังได้', () => {
      assert.equal(emptyRes.body.ready, true);
      assert.equal(emptyRes.body.purchase, undefined);
    });
  } finally {
    restoreLogs();
  }

  /* ---------------- 7. เบราว์เซอร์ ---------------- */
  section('7. Pixel ฝั่งเบราว์เซอร์');
  function page({ host = 'vinko.quest', consent, storage = {} } = {}) {
    const listeners = {}, scripts = [], elements = {};
    if (consent) storage.vinko_consent = consent;
    const el = () => ({ hidden: false, textContent: '', href: '', classList: { add() {} }, setAttribute() {},
      remove() {}, addEventListener(n, f) { this[n] = f; } });
    Object.assign(elements, { '[data-vk-ty-ready]': el(), '[data-vk-ty-loading]': el(), '[data-vk-ty-email]': el(),
      '[data-vk-ty-link]': el(), '[data-vk-allow]': el(), '[data-vk-deny]': el() });
    const firstScript = { parentNode: { insertBefore: s => scripts.push(s) } };
    const c = {
      document: { readyState: 'complete', querySelector: s => elements[s] || null, querySelectorAll: () => [],
        createElement: tag => { const e = el(); e.tagName = tag; e.querySelector = s => elements[s] || null; return e; },
        getElementsByTagName: () => [firstScript], head: { appendChild: e => scripts.push(e) },
        body: { firstChild: null, insertBefore: () => {} } },
      location: { hostname: host, search: '?ref=' + REF },
      localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
      sessionStorage: { getItem: k => k === 'vinko_last_order' ? JSON.stringify({ ref: REF, rid: 'rid-1' }) : null },
      URLSearchParams, Date, console, CustomEvent: function (n) { this.type = n; },
      setTimeout: () => {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
      addEventListener(n, f) { (listeners[n] ||= []).push(f); },
      dispatchEvent(e) { for (const f of listeners[e.type] || []) f(e); }
    };
    c.window = c;
    c.VINKO_CONFIG = { ANALYTICS: { GA4_ID: 'G-W9W53C5DWS', GA4_TEST_ID: 'G-TESTLOCAL1', META_PIXEL_ID: '1366170372169518' } };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(REPO, 'assets/js/site.js'), 'utf8'), c);
    // VM คนละ realm — แปลงผ่าน JSON ก่อนเทียบ
    const fbqCalls = () => (c.fbq && c.fbq.queue ? JSON.parse(JSON.stringify(c.fbq.queue.map(a => Array.from(a)))) : []);
    return { c, storage, scripts, elements, fbqCalls,
      allow() { elements['[data-vk-allow]'].click(); },
      async thankYou(purchase) {
        c.fetch = async () => ({ json: async () => ({ ok: true, ready: true, download_url: '/download?token=X', purchase }) });
        vm.runInContext(fs.readFileSync(path.join(REPO, 'assets/js/thank-you.js'), 'utf8'), c);
        await tickFlush();
      } };
  }
  const livePurchase = { transaction_id: REF, value: 199, currency: 'THB', item_id: 'STORIES', item_name: 'VINKO STORIES', payment_mode: 'live' };

  let p = page();
  await check('ยังไม่ consent -> ไม่โหลด fbevents.js ไม่มี fbq', () => {
    assert.equal(p.c.fbq, undefined);
    assert.ok(!p.scripts.some(s => /fbevents/.test(s.src || '')));
    assert.equal(p.c.VINKO.metaTrack('InitiateCheckout', {}), false);
  });
  await p.thankYou(livePurchase);
  await check('ยังไม่ consent -> thank-you ไม่ยิง Purchase', () => assert.equal(p.fbqCalls().length, 0));
  p.allow();
  await check('กดยอมรับบนหน้า thank-you -> init + PageView + Purchase ที่ค้างอยู่ ส่งทันที', () => {
    const q = p.fbqCalls();
    assert.deepEqual(q[0], ['init', '1366170372169518']);
    assert.deepEqual(q[1], ['track', 'PageView']);
    const purchase = q.find(x => x[1] === 'Purchase');
    assert.ok(purchase, JSON.stringify(q));
    assert.deepEqual(purchase[2], { value: 199, currency: 'THB', content_ids: ['STORIES'], content_type: 'product', num_items: 1 });
    assert.deepEqual(purchase[3], { eventID: REF });
    assert.equal(p.storage['vinko_meta_purchase_sent:' + REF], '1');
  });
  await check('event_id ตรงกันสองฝั่ง: browser eventID === server event_id === order_ref', () => {
    const b = p.fbqCalls().find(x => x[1] === 'Purchase')[3].eventID;
    const s = capi.buildPurchaseEvent(Object.assign({}, { order_ref: REF, amount_satang: 19900, currency: 'THB', customer_email: EMAIL }), {}).event_id;
    assert.equal(b, s); assert.equal(b, REF);
  });

  p = page({ consent: 'granted', storage: { ['vinko_meta_purchase_sent:' + REF]: '1' } });
  await p.thankYou(livePurchase);
  await check('รีเฟรชหน้า thank-you -> ไม่ยิง Purchase ซ้ำ', () => {
    assert.equal(p.fbqCalls().filter(x => x[1] === 'Purchase').length, 0);
  });

  p = page({ consent: 'granted' });
  await p.thankYou(Object.assign({}, livePurchase, { payment_mode: 'test' }));
  await check('payment_mode test -> ไม่ยิง Purchase (guard เดียวกับ GA4)', () => {
    assert.equal(p.fbqCalls().filter(x => x[1] === 'Purchase').length, 0);
  });
  p = page({ consent: 'granted' });
  await p.thankYou(Object.assign({}, livePurchase, { payment_mode: 'unknown' }));
  await check('payment_mode unknown -> ไม่ยิง Purchase', () => {
    assert.equal(p.fbqCalls().filter(x => x[1] === 'Purchase').length, 0);
  });

  p = page({ consent: 'granted' });
  await check('InitiateCheckout หลัง consent บนโดเมนจริง (ไม่มี eventID)', () => {
    assert.equal(p.c.VINKO.metaTrack('InitiateCheckout', { currency: 'THB' }), true);
    assert.deepEqual(p.fbqCalls().pop(), ['track', 'InitiateCheckout', { currency: 'THB' }]);
  });
  p = page({ consent: 'denied' });
  await check('ปฏิเสธคุกกี้ -> ไม่มี fbq, metaTrack คืน false', () => {
    assert.equal(p.c.fbq, undefined);
    assert.equal(p.c.VINKO.metaTrack('InitiateCheckout', {}), false);
  });
  for (const host of ['localhost', 'preview.vercel.app', 'vinko.quest.evil.example']) {
    p = page({ host, consent: 'granted' });
    await check(host + ' -> ไม่โหลด Pixel ไม่ยิง Meta', () => {
      assert.equal(p.c.fbq, undefined);
      assert.equal(p.c.VINKO.metaTrack('Purchase', { payment_mode: 'test' }, REF), false);
    });
  }
  p = page({ consent: 'granted' });
  await p.thankYou(customPurchase);
  const gaScript = p.scripts.find(s => /googletagmanager/.test(s.src || ''));
  if (gaScript) gaScript.onload();
  await check('CUSTOM บน vinko.quest -> Pixel Purchase eventID = order_ref, value = ยอด DB, content_ids ครบ', () => {
    const pur = p.fbqCalls().find(x => x[1] === 'Purchase');
    assert.ok(pur, 'no Pixel Purchase');
    assert.deepEqual(pur[3], { eventID: customPurchase.transaction_id });
    assert.equal(pur[2].value, customPurchase.value);
    assert.deepEqual([...pur[2].content_ids].sort(), ['STORY-01', 'STORY-03']);
    assert.equal(pur[2].num_items, 2);
  });
  await check('CUSTOM บน vinko.quest -> GA4 purchase transaction_id = order_ref, value = ยอด DB, items 2 เล่ม', () => {
    const ev = JSON.parse(JSON.stringify((p.c.dataLayer || []).filter(x => x[0] === 'event' && x[1] === 'purchase')));
    assert.equal(ev.length, 1, 'GA4 purchase count');
    assert.equal(ev[0][2].transaction_id, customPurchase.transaction_id);
    assert.equal(ev[0][2].value, customPurchase.value);
    assert.equal(ev[0][2].send_to, 'G-W9W53C5DWS');
    assert.deepEqual(ev[0][2].items.map(i => i.item_id).sort(), ['STORY-01', 'STORY-03']);
  });

  await check('checkout.js เรียก InitiateCheckout ตอนเริ่มหน้าและหลัง consent', () => {
    const src = fs.readFileSync(path.join(REPO, 'assets/js/checkout.js'), 'utf8');
    assert.match(src, /V\.metaTrack\("InitiateCheckout"/);
    assert.match(src, /addEventListener\("vinko:consent-granted", sendInitiateCheckout\)/);
    assert.match(src, /setupOmise\(\);\s*sendInitiateCheckout\(\);/);
  });

  finished = true;
  console.log('\nMeta CAPI: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { restoreLogs(); console.error(e); process.exit(1); });

function tickFlush() { return new Promise(r => setTimeout(r, 20)); }
