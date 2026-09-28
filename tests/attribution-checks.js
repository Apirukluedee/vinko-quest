/* ============================================================
   ชุดตรวจ attribution snapshot ของออเดอร์ (migration 008)

   รันด้วย:  node tests/attribution-checks.js
   ไม่ต้องมี key จริง ไม่ยิงเครือข่าย — fetch ถูก stub ทั้งหมด
   site.js รันใน VM แยก ไม่มี browser

   ครอบคลุม:
   1. buildSnapshot — whitelist, ความยาว, consent, click-id-only, input เสีย
   2. site.js — click id นับเป็น hit, ยังต้องรอ consent
   3. create-charge — บันทึก snapshot/status, ไม่กระทบราคา/การตรวจ,
      คอลัมน์ยังไม่มี (ก่อนรัน 008) ต้องลองใหม่แล้วขายได้, คำขอซ้ำไม่เปลี่ยน
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}
function section(t) { console.log('\n' + t); }

const { buildSnapshot } = require(path.join(REPO, 'api', '_lib', 'attribution.js'));
const NOW = '2026-09-28T10:00:00.000Z';

(async function run() {

  /* ---------------- 1. buildSnapshot ---------------- */
  section('1. buildSnapshot');

  const touch = {
    utm_source: 'offline', utm_medium: 'xstand', utm_campaign: 't21korat_sep2026',
    utm_content: 'qr_xs_a_line_01', utm_term: 'kids',
    activation_id: 'QR-XS-A-LINE-01__T21KORAT-2026-09__r01',
    click_id_platform: 'meta', click_id_value: 'IwAR0abcDEF',
    t: '2026-09-27T08:00:00.000Z'
  };

  await check('consent false -> no_consent, snapshot null', () => {
    assert.deepEqual(buildSnapshot({ first: touch, last: touch }, false, NOW), { snapshot: null, status: 'no_consent' });
  });
  await check('consent ไม่ได้ส่งมา / ไม่ใช่ boolean -> none ไม่เก็บ', () => {
    for (const c of [undefined, null, 'true', 1, {}]) {
      assert.deepEqual(buildSnapshot({ first: touch, last: touch }, c, NOW), { snapshot: null, status: 'none' });
    }
  });
  await check('consent true แต่ไม่มี touch -> none', () => {
    for (const a of [{}, { first: null, last: null }, { first: {}, last: { t: NOW } }]) {
      assert.deepEqual(buildSnapshot(a, true, NOW), { snapshot: null, status: 'none' });
    }
  });
  await check('ครบทุก field -> captured พร้อมโครงสร้าง schema_version 1', () => {
    const r = buildSnapshot({ first: touch, last: touch }, true, NOW);
    assert.equal(r.status, 'captured');
    assert.deepEqual(r.snapshot, { first: touch, last: touch, captured_at: NOW, schema_version: 1 });
  });
  await check('key ที่ไม่อยู่ใน whitelist ถูกทิ้งทั้งหมด', () => {
    const dirty = Object.assign({}, touch, { email: 'x@example.com', utm_id: '1', __proto__x: 1, gclid: 'raw', nested: { a: 1 } });
    const r = buildSnapshot({ first: dirty, last: dirty, extra: 'top', captured_at: 'fake', schema_version: 99 }, true, NOW);
    assert.deepEqual(Object.keys(r.snapshot).sort(), ['captured_at', 'first', 'last', 'schema_version']);
    assert.deepEqual(Object.keys(r.snapshot.first).sort(), Object.keys(touch).sort());
    assert.equal(r.snapshot.schema_version, 1);
    assert.equal(r.snapshot.captured_at, NOW);
  });
  await check('ตัดความยาว: text 100, click_id_value 255 และ trim', () => {
    const long = { utm_source: '  ' + 'a'.repeat(300) + '  ', click_id_platform: 'google', click_id_value: 'Z'.repeat(400) };
    const r = buildSnapshot({ first: long, last: long }, true, NOW);
    assert.equal(r.snapshot.first.utm_source, 'a'.repeat(100));
    assert.equal(r.snapshot.first.click_id_value.length, 255);
  });
  await check('\\u0000 / control char / surrogate เดี่ยว ถูกตัด (jsonb ปฏิเสธ = ออเดอร์พัง)', () => {
    const bad = { utm_source: 'fa\u0000ce\u0007book\uD800', utm_campaign: '\uDC00x' };
    const r = buildSnapshot({ first: bad, last: bad }, true, NOW);
    assert.equal(r.snapshot.first.utm_source, 'facebook');
    assert.equal(r.snapshot.first.utm_campaign, 'x');
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(r.snapshot)));
    assert.ok(!/\\u(0000|d[89a-f])/i.test(JSON.stringify(r.snapshot)));
  });
  await check('ตัดความยาวไม่ผ่ากลาง emoji (ไม่เกิด surrogate เดี่ยว)', () => {
    const r = buildSnapshot({ last: { utm_campaign: 'a'.repeat(99) + '😀😀' } }, true, NOW);
    assert.equal(r.snapshot.last.utm_campaign, 'a'.repeat(99) + '😀');
  });
  await check('click-id อย่างเดียว (ไม่มี utm) นับเป็น captured', () => {
    const c = { click_id_platform: 'tiktok', click_id_value: 'E.C.P.abc', t: '2026-09-28T09:00:00.000Z' };
    const r = buildSnapshot({ first: c, last: c }, true, NOW);
    assert.equal(r.status, 'captured');
    assert.deepEqual(r.snapshot.last, c);
  });
  await check('click_id_platform นอก enum หรือไม่มี value -> ทิ้งทั้งคู่', () => {
    const r1 = buildSnapshot({ last: { utm_source: 'x', click_id_platform: 'bing', click_id_value: 'abc' } }, true, NOW);
    assert.deepEqual(r1.snapshot.last, { utm_source: 'x' });
    const r2 = buildSnapshot({ last: { click_id_platform: 'meta' } }, true, NOW);
    assert.equal(r2.status, 'none');
    const r3 = buildSnapshot({ last: { utm_source: 'x', click_id_platform: 'META', click_id_value: 'v' } }, true, NOW);
    assert.equal(r3.snapshot.last.click_id_platform, 'meta');
  });
  await check('t: ต้องเป็น ISO และไม่เกิน now+5 นาที', () => {
    const at = t => buildSnapshot({ last: { utm_source: 'x', t } }, true, NOW).snapshot.last.t;
    assert.equal(at('2026-09-28T10:04:59.000Z'), '2026-09-28T10:04:59.000Z');
    assert.equal(at('2026-09-28T17:00:00+07:00'), '2026-09-28T10:00:00.000Z');
    assert.equal(at('2026-09-28T10:05:01.000Z'), undefined);
    assert.equal(at('Sep 28 2026'), undefined);
    assert.equal(at('2026-13-45T99:99:00Z'), undefined);
    assert.equal(at(1759053600000), undefined);
  });
  await check('touch เดียวที่ใช้ได้ -> อีกฝั่งเป็น null', () => {
    const r = buildSnapshot({ first: 'garbage', last: { utm_source: 'line' } }, true, NOW);
    assert.equal(r.status, 'captured');
    assert.equal(r.snapshot.first, null);
    assert.deepEqual(r.snapshot.last, { utm_source: 'line' });
  });
  await check('input เสียทุกแบบ -> ไม่ throw และได้ none', () => {
    const evil = {}; Object.defineProperty(evil, 'first', { get() { throw new Error('boom'); } });
    for (const a of [null, undefined, 'str', 42, [], [touch], evil, { first: [touch] }]) {
      const r = buildSnapshot(a, true, NOW);
      assert.deepEqual(r, { snapshot: null, status: 'none' });
    }
    assert.deepEqual(buildSnapshot({ first: touch }, true, 'not-a-date'), { snapshot: null, status: 'none' });
    assert.deepEqual(buildSnapshot({ first: touch }, true, undefined), { snapshot: null, status: 'none' });
  });
  await check('ค่าที่ไม่ใช่ string ใน field ถูกทิ้ง', () => {
    const r = buildSnapshot({ last: { utm_source: 123, utm_medium: ['a'], utm_campaign: 'ok' } }, true, NOW);
    assert.deepEqual(r.snapshot.last, { utm_campaign: 'ok' });
  });

  /* ---------------- 2. site.js ---------------- */
  section('2. site.js เก็บ click id เป็น hit (หลัง consent เท่านั้น)');

  function sitePage(query, storage) {
    storage = storage || {};
    const el = () => ({ hidden: false, classList: { add() {} }, setAttribute() {}, addEventListener() {}, remove() {} });
    const c = {
      document: {
        readyState: 'complete', querySelector: () => null, querySelectorAll: () => [],
        createElement: () => Object.assign(el(), { querySelector: () => el() }),
        head: { appendChild() {} }, body: { firstChild: null, insertBefore() {} }
      },
      location: { hostname: 'localhost', search: query },
      localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
      URLSearchParams, Date, console, CustomEvent: function () {},
      setInterval() {}, clearInterval() {}, addEventListener() {}, dispatchEvent() {}
    };
    c.window = c;
    c.VINKO_CONFIG = {};
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(REPO, 'assets/js/site.js'), 'utf8'), c);
    return { c, storage };
  }

  await check('fbclid อย่างเดียวนับเป็น hit -> meta + ค่าดิบ (ไม่ lowercase)', () => {
    const p = sitePage('?fbclid=IwAR0AbC_dEf', { vinko_consent: 'granted' });
    const a = JSON.parse(p.storage.vinko_attr);
    assert.equal(a.first.click_id_platform, 'meta');
    assert.equal(a.first.click_id_value, 'IwAR0AbC_dEf');
    assert.equal(a.first.utm_source, undefined);
    assert.ok(a.first.t);
  });
  await check('gclid -> google, ttclid -> tiktok', () => {
    assert.equal(JSON.parse(sitePage('?gclid=Cj0K', { vinko_consent: 'granted' }).storage.vinko_attr).last.click_id_platform, 'google');
    assert.equal(JSON.parse(sitePage('?ttclid=E.C.P', { vinko_consent: 'granted' }).storage.vinko_attr).last.click_id_platform, 'tiktok');
  });
  await check('utm + click id เก็บรวมใน touch เดียว, ตัด click id ที่ 255', () => {
    const p = sitePage('?utm_source=Facebook&fbclid=' + 'x'.repeat(400), { vinko_consent: 'granted' });
    const a = JSON.parse(p.storage.vinko_attr);
    assert.equal(a.last.utm_source, 'facebook');
    assert.equal(a.last.click_id_value.length, 255);
  });
  await check('หลาย click id พร้อมกัน -> ใช้ตัวแรกตามลำดับ fbclid, gclid, ttclid', () => {
    const a = JSON.parse(sitePage('?ttclid=t&gclid=g', { vinko_consent: 'granted' }).storage.vinko_attr);
    assert.equal(a.last.click_id_platform, 'google');
    assert.equal(a.last.click_id_value, 'g');
  });
  await check('ยังไม่ได้ consent -> ไม่เก็บ click id', () => {
    assert.equal(sitePage('?fbclid=abc', {}).storage.vinko_attr, undefined);
    assert.equal(sitePage('?fbclid=abc', { vinko_consent: 'denied' }).storage.vinko_attr, undefined);
  });
  await check('click-id-only hit ใหม่ทับ last แต่ไม่แตะ first', () => {
    const s = { vinko_consent: 'granted' };
    sitePage('?utm_source=offline', s);
    sitePage('?gclid=Cj0K', s);
    const a = JSON.parse(s.vinko_attr);
    assert.equal(a.first.utm_source, 'offline');
    assert.equal(a.last.click_id_platform, 'google');
  });
  await check('ผลจาก site.js ผ่าน buildSnapshot แล้วได้ captured', () => {
    const p = sitePage('?utm_source=test&utm_campaign=b2check&fbclid=IwAR0', { vinko_consent: 'granted' });
    const r = buildSnapshot(JSON.parse(JSON.stringify(p.c.VINKO.attribution())), p.c.VINKO.consentGranted(), new Date().toISOString());
    assert.equal(r.status, 'captured');
    assert.equal(r.snapshot.last.utm_campaign, 'b2check');
    assert.equal(r.snapshot.last.click_id_platform, 'meta');
  });

  /* ---------------- 3. create-charge ---------------- */
  section('3. create-charge บันทึก attribution โดยไม่กระทบการขาย');

  process.env.OMISE_SECRET_KEY = 'skey_test_FAKE';
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_FAKE';
  process.env.APP_BASE_URL = 'https://vinko.example';
  process.env.IP_HASH_SALT = 'test-salt';

  const DB = { orders: [], order_items: [], counter: 0, missingColumns: [], orderInserts: [], orderQueue: [] };
  const SB = 'https://fake.supabase.co/rest/v1';
  const reply = (status, body, headers) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: k => (headers || {})[k.toLowerCase()] || null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body
  });

  global.fetch = async function (url, opts) {
    opts = opts || {};
    const u = String(url), method = (opts.method || 'GET').toUpperCase();
    if (u.startsWith(SB)) {
      const [p, qs] = u.slice(SB.length).split('?');
      if (p === '/rpc/next_order_ref') return reply(200, 'VK-2609-' + String(++DB.counter).padStart(4, '0'));
      const table = p.slice(1);
      const filters = [...new URLSearchParams(qs || '')].filter(([k]) => k !== 'select')
        .map(([k, v]) => [k, v.replace(/^(eq|gte)\./, ''), v.startsWith('gte.')]);
      const match = r => filters.every(([k, v, gte]) => gte ? new Date(r[k]) >= new Date(v) : String(r[k]) === v);
      if (method === 'HEAD') return reply(200, undefined, { 'content-range': '0-0/' + DB[table].filter(match).length });
      if (method === 'GET') return reply(200, DB[table].filter(match));
      if (method === 'POST') {
        const rows = [].concat(JSON.parse(opts.body));
        if (table === 'orders') {
          DB.orderInserts.push(rows[0]);
          // เทสต์กำหนดผลของ insert ครั้งถัดไปได้: คืน reply, throw (timeout/network) หรือ undefined = ทำงานปกติ
          const scripted = DB.orderQueue.shift();
          if (scripted) { const out = scripted(rows[0]); if (out) return out; }
          // จำลอง PostgREST ตอนคอลัมน์ยังไม่มี (ก่อนรัน 008)
          const miss = DB.missingColumns.find(c => c in rows[0]);
          if (miss) return reply(400, { code: 'PGRST204', message: "Could not find the '" + miss + "' column of 'orders' in the schema cache" });
          if (rows[0].client_request_id && DB.orders.some(o => o.client_request_id === rows[0].client_request_id)) {
            return reply(409, { code: '23505', message: 'duplicate key' });
          }
        }
        const created = rows.map((r, i) => Object.assign({ id: table + '-' + (DB[table].length + i + 1), created_at: new Date().toISOString() }, r));
        DB[table].push(...created);
        return reply(201, created);
      }
      if (method === 'PATCH') {
        const hit = DB[table].filter(match); hit.forEach(r => Object.assign(r, JSON.parse(opts.body)));
        return reply(200, hit);
      }
    }
    if (u.startsWith('https://api.omise.co')) {
      const p = u.slice('https://api.omise.co'.length);
      const b = Object.fromEntries(new URLSearchParams(opts.body || ''));
      if (method === 'POST' && p === '/sources') return reply(200, { id: 'src_test_1', type: 'promptpay', amount: Number(b.amount) });
      if (method === 'POST' && p === '/charges') {
        return reply(200, { id: 'chrg_test_' + DB.counter, status: 'pending', amount: Number(b.amount), metadata: {},
          source: { type: 'promptpay', expires_at: NOW, scannable_code: { image: { download_uri: 'https://api.omise.co/qr.png' } } } });
      }
    }
    throw new Error('unmocked fetch: ' + method + ' ' + u);
  };

  function load() {
    for (const f of ['create-charge.js', '_lib/supabase.js', '_lib/attribution.js']) {
      delete require.cache[require.resolve(path.join(REPO, 'api', f))];
    }
    return require(path.join(REPO, 'api', 'create-charge.js'));
  }
  function reset() { DB.orders = []; DB.order_items = []; DB.counter = 0; DB.missingColumns = []; DB.orderInserts = []; DB.orderQueue = []; }
  async function charge(extra) {
    const r = { statusCode: 200, headers: {}, body: null };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = c => { r.statusCode = c; return r; };
    r.send = b => { r.body = typeof b === 'string' ? JSON.parse(b) : b; return r; };
    await load()({ method: 'POST', url: '/', headers: { 'x-forwarded-for': '9.9.9.' + DB.counter }, socket: {},
      body: Object.assign({
        customer_name: 'ทดสอบ', customer_email: 'test@example.com', consent_terms: true, consent_privacy: true,
        package_code: 'LAB', payment_method: 'promptpay'
      }, extra) }, r);
    return r;
  }
  const attrBody = { attribution: { first: { utm_source: 'test', t: NOW }, last: { utm_source: 'test', utm_campaign: 'b2check', t: NOW } }, attribution_consent: true };

  // เก็บ console.error ไว้ตรวจ log แทนการพ่นออกจอ
  const logs = [];
  const origError = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try {
    reset();
    let r = await charge(attrBody);
    await check('consent + utm -> แถวมี status captured และ snapshot', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
      const o = DB.orders[0];
      assert.equal(o.attribution_status, 'captured');
      assert.equal(o.attribution_snapshot.last.utm_campaign, 'b2check');
      assert.equal(o.attribution_snapshot.schema_version, 1);
      assert.equal(o.attribution_snapshot.captured_at, o.consent_terms_at);
    });
    await check('attribution ไม่แตะราคา (LAB = 19900)', () => {
      assert.equal(r.body.amount_satang, 19900);
      assert.equal(DB.orders[0].amount_satang, 19900);
    });

    reset();
    r = await charge({ attribution: attrBody.attribution, attribution_consent: false });
    await check('consent false -> no_consent ไม่เก็บ snapshot แม้ client ส่งมา', () => {
      assert.equal(r.body.ok, true);
      assert.equal(DB.orders[0].attribution_status, 'no_consent');
      assert.equal(DB.orders[0].attribution_snapshot, null);
    });

    reset();
    r = await charge({});
    await check('client เก่าไม่ส่งอะไรมา -> none และสั่งซื้อได้ปกติ', () => {
      assert.equal(r.body.ok, true);
      assert.equal(DB.orders[0].attribution_status, 'none');
      assert.equal(DB.orders[0].attribution_snapshot, null);
    });

    reset();
    r = await charge({ attribution: 'x'.repeat(10000), attribution_consent: true });
    await check('attribution ขยะ -> none และสั่งซื้อได้ปกติ', () => {
      assert.equal(r.body.ok, true);
      assert.equal(DB.orders[0].attribution_status, 'none');
    });

    reset();
    r = await charge(Object.assign({}, attrBody, { customer_email: 'not-an-email' }));
    await check('attribution ไม่ช่วยให้ input ผิดผ่านการตรวจ', () => {
      assert.equal(r.statusCode, 400);
      assert.equal(DB.orders.length, 0);
    });

    reset();
    DB.missingColumns = ['attribution_snapshot', 'attribution_status'];
    logs.length = 0;
    r = await charge(attrBody);
    await check('ก่อนรัน 008 (คอลัมน์ยังไม่มี) -> ลองใหม่โดยไม่มี attribution แล้วขายได้', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
      assert.equal(DB.orderInserts.length, 2);
      assert.ok('attribution_status' in DB.orderInserts[0]);
      assert.ok(!('attribution_status' in DB.orderInserts[1]) && !('attribution_snapshot' in DB.orderInserts[1]));
      assert.equal(DB.orders.length, 1);
      assert.equal(DB.orders[0].amount_satang, 19900);
    });
    await check('ก่อนรัน 008 -> log ดังว่า ATTRIBUTION_COLUMNS_MISSING และไม่พ่นค่า snapshot', () => {
      const l = logs.find(x => /ATTRIBUTION_COLUMNS_MISSING/.test(x));
      assert.ok(l, logs.join('\n'));
      assert.ok(!/b2check|test@example\.com/.test(logs.join('\n')));
    });
    await check('หลัง retry -> log บอกผลว่าสำเร็จ', () => {
      assert.ok(logs.some(x => /ATTRIBUTION_RETRY_OK/.test(x)), logs.join('\n'));
    });

    /* ---- retry แคบ: ห้ามลองซ้ำถ้าไม่แน่ใจว่าแถวแรกไม่ได้ถูกบันทึก ---- */
    // details ของ PostgREST มีค่าทั้งแถว — ใส่อีเมลไว้เพื่อพิสูจน์ว่าไม่หลุดลง log
    const leakyDetails = 'Failing row contains (x, VK-2609-0001, LAB, 19900, THB, ทดสอบ, test@example.com, b2check)';

    reset(); logs.length = 0;
    DB.orderQueue = [() => reply(503, { code: 'PGRST000', message: 'upstream timed out', details: leakyDetails })];
    r = await charge(attrBody);
    await check('insert แรกได้ 5xx -> ไม่ insert ซ้ำ และตอบ error ตามเดิม', () => {
      assert.equal(DB.orderInserts.length, 1);
      assert.equal(r.statusCode, 500);
      assert.equal(r.body.ok, false);
      assert.ok(!logs.some(x => /ATTRIBUTION_(COLUMNS_MISSING|CHECK_VIOLATION|RETRY)/.test(x)), logs.join('\n'));
    });
    await check('error path log แค่ code + message ไม่มี details/อีเมล/attribution', () => {
      const all = logs.join('\n');
      assert.ok(/code: PGRST000/.test(all), all);
      assert.ok(!/Failing row|test@example\.com|b2check/.test(all), all);
    });

    reset(); logs.length = 0;
    DB.orderQueue = [() => { throw new Error('fetch failed: ETIMEDOUT'); }];
    let threw = null;
    try { r = await charge(attrBody); } catch (e) { threw = e; }
    await check('insert แรก timeout/network (throw) -> ไม่ insert ซ้ำ', () => {
      assert.equal(DB.orderInserts.length, 1);
      assert.ok(threw || r.statusCode >= 500);
    });

    reset(); logs.length = 0;
    DB.orderQueue = [() => reply(400, { code: '23514', message: 'new row for relation "orders" violates check constraint "orders_package_code_check"', details: leakyDetails })];
    r = await charge(attrBody);
    await check('23514 จาก constraint อื่น (เช่น package_code แบบเคส 007) -> ไม่ retry', () => {
      assert.equal(DB.orderInserts.length, 1);
      assert.equal(r.statusCode, 500);
      assert.ok(/orders_package_code_check/.test(logs.join('\n')), 'ชื่อ constraint ต้องยังอยู่ใน log ไว้ debug');
      assert.ok(!/Failing row|test@example\.com/.test(logs.join('\n')));
    });

    reset(); logs.length = 0;
    DB.orderQueue = [() => reply(400, { code: '42703', message: 'column "attribution_status" of relation "orders" does not exist' })];
    r = await charge(attrBody);
    await check('(a) 42703 คอลัมน์ attribution ไม่มี -> retry แล้วขายได้', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
      assert.equal(DB.orderInserts.length, 2);
      assert.ok(!('attribution_status' in DB.orderInserts[1]));
    });

    reset(); logs.length = 0;
    DB.orderQueue = [() => reply(400, { code: '23514', message: 'new row for relation "orders" violates check constraint "orders_attribution_consistent_check"', details: leakyDetails })];
    r = await charge(attrBody);
    await check('(b) 23514 จาก orders_attribution_* -> retry แล้วขายได้', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
      assert.equal(DB.orderInserts.length, 2);
      assert.equal(DB.orders.length, 1);
      assert.ok(!('attribution_snapshot' in DB.orderInserts[1]));
      assert.ok(logs.some(x => /ATTRIBUTION_CHECK_VIOLATION/.test(x)) && logs.some(x => /ATTRIBUTION_RETRY_OK/.test(x)), logs.join('\n'));
      assert.ok(!/Failing row|test@example\.com|b2check/.test(logs.join('\n')));
    });

    reset(); logs.length = 0;
    DB.orderQueue = [
      () => reply(400, { code: 'PGRST204', message: "Could not find the 'attribution_snapshot' column of 'orders' in the schema cache" }),
      () => reply(500, { code: 'XX000', message: 'internal error', details: leakyDetails })
    ];
    r = await charge(attrBody);
    await check('retry แล้วยังพัง -> log ว่า RETRY_FAILED พร้อม code เท่านั้น แล้วตอบ error', () => {
      assert.equal(DB.orderInserts.length, 2);
      assert.equal(r.statusCode, 500);
      assert.ok(logs.some(x => /ATTRIBUTION_RETRY_FAILED.*code: XX000/.test(x)), logs.join('\n'));
      assert.ok(!/Failing row|test@example\.com/.test(logs.join('\n')));
    });

    // คำขอซ้ำที่ชนกันพอดี: select กันซ้ำไม่เจอ แต่ระหว่างนั้นอีกคำขอบันทึกไปก่อน
    // insert แรกพังเพราะ attribution -> retry -> ชน unique -> ต้องคืนออเดอร์เดิม
    reset(); logs.length = 0;
    DB.orderQueue = [
      () => reply(400, { code: '23514', message: 'new row for relation "orders" violates check constraint "orders_attribution_status_check"' }),
      row => {
        DB.orders.push({ id: 'orders-race', order_ref: 'VK-2609-0999', status: 'pending', omise_charge_id: null,
          payment_method: 'promptpay', amount_satang: 19900, client_request_id: row.client_request_id });
        return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "orders_client_request_id_key"' });
      }
    ];
    r = await charge(Object.assign({}, attrBody, { client_request_id: 'rid-race-0001' }));
    await check('(3) unique violation หลัง retry -> คืนออเดอร์เดิมเหมือนเดิม', () => {
      assert.equal(DB.orderInserts.length, 2);
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      assert.equal(r.body.order_ref, 'VK-2609-0999');
      assert.equal(r.body.duplicate, true);
      assert.equal(DB.orders.length, 1);
    });

    reset();
    r = await charge(Object.assign({}, attrBody, { client_request_id: 'rid-attr-0001' }));
    const firstRef = r.body.order_ref;
    const again = await charge({ client_request_id: 'rid-attr-0001', attribution: { last: { utm_source: 'other' } }, attribution_consent: true });
    await check('คำขอซ้ำ -> คืนออเดอร์เดิม ไม่ insert ใหม่ ไม่เขียน attribution ทับ', () => {
      assert.equal(again.body.duplicate, true);
      assert.equal(again.body.order_ref, firstRef);
      assert.equal(DB.orders.length, 1);
      assert.equal(DB.orderInserts.length, 1);
      assert.equal(DB.orders[0].attribution_snapshot.last.utm_source, 'test');
    });
  } finally {
    console.error = origError;
  }

  console.log('\n' + '='.repeat(56));
  console.log('Attribution: ' + passed + ' passed, ' + failed + ' failed (no network, no real DB).');
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nชุดทดสอบล้ม:', e); process.exit(1); });
