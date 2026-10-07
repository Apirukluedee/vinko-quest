/* ============================================================
   ชุดตรวจ "ลิงก์ดาวน์โหลดชนกัน" ระหว่าง webhook (deliver) กับหน้าขอบคุณ (claim-download)

   รันด้วย:  node tests/token-race-checks.js
   ไม่ยิงเครือข่าย — Supabase ถูก stub, ส่งอีเมลถูกแทนด้วยตัวปลอม

   เคสจริงที่เจอ (VK-2610-0001, 8 ต.ค. 2569):
     webhook ออก token B ใส่อีเมล → หน้าขอบคุณที่อ่านออเดอร์ไปก่อนหน้า (ยังไม่มี token)
     ออก token A ทับ → ลิงก์ในอีเมลขึ้น "ไม่พบลิงก์นี้"
   จำลองการ "อ่านค่าเก่า" ด้วย stale read: GET ถัดไปคืนออเดอร์ที่ยังไม่มี token
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
process.on('exit', () => {
  if (!finished) { console.log('\nFAIL  ชุดทดสอบไม่จบ — ' + passed + ' passed ก่อนค้าง'); process.exitCode = 1; }
});

Object.assign(process.env, {
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FAKEFAKEFAKEFAKE',
  OMISE_SECRET_KEY: 'skey_test_FAKE', OMISE_PUBLIC_KEY: 'pkey_test_FAKE', APP_BASE_URL: 'https://vinko.quest',
  IP_HASH_SALT: 'salt-fixture', RESEND_API_KEY: 're_FAKE'
});

/* ---------- Supabase ปลอม ---------- */
const SB = 'https://fake.supabase.co/rest/v1/';
const S = { orders: [], order_items: [], staleReads: 0 };
const reply = (status, body, headers) => ({ ok: status < 300, status,
  headers: { get: k => (headers || {})[k.toLowerCase()] || null },
  text: async () => JSON.stringify(body), json: async () => body });
function filt(qs) {
  return [...new URLSearchParams(qs || '')].filter(([k]) => !['select', 'limit', 'order'].includes(k));
}
function matches(row, f) {
  return f.every(([k, v]) => v === 'is.null' ? row[k] == null : String(row[k]) === v.replace(/^eq\./, ''));
}
global.fetch = async (url, opts) => {
  const u = String(url), method = ((opts && opts.method) || 'GET').toUpperCase();
  if (!u.startsWith(SB)) throw new Error('unmocked fetch ' + method + ' ' + u);
  const [table, qs] = u.slice(SB.length).split('?');
  const f = filt(qs);
  if (method === 'HEAD') return reply(200, null, { 'content-range': '0-0/0' });   // email_events: ยังไม่เคยส่ง
  if (method === 'GET') {
    let rows = (S[table] || []).filter(r => matches(r, f)).map(r => Object.assign({}, r));
    // จำลองอีก request ที่อ่านออเดอร์ "ก่อน" อีกทางจะออก token
    if (table === 'orders' && S.staleReads > 0 && /download_token/.test(qs)) {
      S.staleReads--;
      rows = rows.map(r => Object.assign(r, { download_token: null, token_expires_at: null }));
    }
    return reply(200, rows);
  }
  if (method === 'PATCH') {
    const hit = (S[table] || []).filter(r => matches(r, f));
    hit.forEach(r => Object.assign(r, JSON.parse(opts.body)));
    return reply(200, hit.map(r => Object.assign({}, r)));
  }
  throw new Error('unmocked ' + method + ' ' + u);
};

/* ---------- อีเมลปลอม: เก็บ token ที่ใส่ในอีเมล ---------- */
const mails = [];
function stub(rel, exports) {
  const p = require.resolve(path.join(REPO, 'api', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('_lib/email.js', {
  purchaseEmail: o => ({ subject: 'x', html: 'token=' + o.token, token: o.token }),
  send: async (kind, to, payload) => { mails.push(payload.token); return { ok: true, id: 'm1' }; },
  connectLineUrl: () => null, CONNECT_TTL_PAGE_MS: 1800000, CONNECT_TTL_EMAIL_MS: 1
});

function load(rel) {
  for (const f of ['_lib/tokens.js', '_lib/deliver-order.js', 'claim-download.js', '_lib/supabase.js']) {
    delete require.cache[require.resolve(path.join(REPO, 'api', f))];
  }
  return require(path.join(REPO, 'api', rel));
}
const RID = 'rid-0123456789abcdef';
function reset(extra) {
  mails.length = 0; S.staleReads = 0;
  S.orders = [Object.assign({ id: 'o1', order_ref: 'VK-2610-0001', status: 'paid', package_code: 'LAB',
    amount_satang: 19900, currency: 'THB', customer_email: 'parent@example.com', customer_name: 'x',
    client_request_id: RID, download_token: null, token_expires_at: null, reader_token: 'R',
    omise_charge_id: 'chrg_test_1' }, extra)];
  S.order_items = [{ id: 'i1', order_id: 'o1', product_code: 'LAB', title: 'LAB', delivery_type: 'instant' }];
}
async function claim() {
  const res = { statusCode: 200, body: null, setHeader() {} };
  res.status = c => { res.statusCode = c; return res; };
  res.send = b => { res.body = JSON.parse(b); return res; };
  await load('claim-download.js')({ method: 'POST', headers: {}, body: { order_ref: 'VK-2610-0001', client_request_id: RID } }, res);
  return res;
}
const tokenIn = url => decodeURIComponent((url.match(/token=([^&]+)/) || [])[1] || '');
const dbToken = () => S.orders[0].download_token;

(async function run() {
  const logs = []; const ow = console.warn, oe = console.error;
  console.warn = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '));
  try {
    console.log('\n1. issueIfMissing');
    reset();
    let tokens = load('_lib/tokens.js');
    let r = await tokens.issueIfMissing('o1');
    await check('ยังไม่มี token -> ออกใหม่ created=true และบันทึกลงฐานข้อมูล', () => {
      assert.equal(r.created, true);
      assert.equal(dbToken(), r.token);
      assert.ok(r.token.length >= 32);
    });
    const first = r.token;
    r = await tokens.issueIfMissing('o1');
    await check('มี token แล้ว -> ไม่ทับ คืนตัวเดิม created=false', () => {
      assert.equal(r.created, false);
      assert.equal(r.token, first);
      assert.equal(dbToken(), first);
    });

    console.log('\n2. เคสจริง: webhook ออกก่อน แล้วหน้าขอบคุณที่อ่านค่าเก่ามาทีหลัง');
    reset();
    await load('_lib/deliver-order.js').deliver('VK-2610-0001');
    const emailed = mails[0];
    S.staleReads = 1;                         // หน้าขอบคุณอ่านออเดอร์ไปตอนยังไม่มี token
    let c = await claim();
    await check('ลิงก์ในอีเมลยังใช้ได้: token ในฐานข้อมูล = token ในอีเมล', () => {
      assert.ok(emailed);
      assert.equal(dbToken(), emailed);
    });
    await check('หน้าขอบคุณได้ token ตัวเดียวกับอีเมล', () => {
      assert.equal(c.body.ready, true);
      assert.equal(tokenIn(c.body.download_url), emailed);
    });
    await check('ไม่ log ว่า "ออก token ก่อน webhook" เพราะไม่ได้ออกใหม่', () => {
      assert.ok(!logs.some(l => l.includes('ออก token ก่อน webhook')));
    });

    console.log('\n3. กลับด้าน: หน้าขอบคุณออกก่อน แล้ว webhook ที่อ่านค่าเก่ามาทีหลัง');
    reset(); logs.length = 0;
    c = await claim();
    const shown = tokenIn(c.body.download_url);
    S.staleReads = 1;                         // deliver อ่านออเดอร์ไปตอนยังไม่มี token
    await load('_lib/deliver-order.js').deliver('VK-2610-0001');
    await check('อีเมลได้ token ตัวเดียวกับที่หน้าขอบคุณโชว์ และฐานข้อมูลไม่ถูกทับ', () => {
      assert.equal(mails[0], shown);
      assert.equal(dbToken(), shown);
    });
    await check('log บอกว่าหน้าขอบคุณออกก่อน (ไม่ใช่ "webhook ทำไม่สำเร็จ")', () => {
      assert.ok(logs.some(l => l.includes('ออก token ก่อน webhook')));
      assert.ok(!logs.some(l => l.includes('webhook ทำไม่สำเร็จ')));
    });

    console.log('\n4. พฤติกรรมเดิมที่ต้องคงไว้');
    reset({ download_token: 'OLD_EXPIRED_TOKEN_0123456789012345678901', token_expires_at: '2020-01-01T00:00:00Z' });
    await load('_lib/deliver-order.js').deliver('VK-2610-0001');
    await check('token หมดอายุแล้ว -> deliver ออกใหม่ทับได้ตามเดิม', () => {
      assert.notEqual(dbToken(), 'OLD_EXPIRED_TOKEN_0123456789012345678901');
      assert.equal(mails[0], dbToken());
    });
    const valid = 'VALID_TOKEN_0123456789012345678901234567';
    reset({ download_token: valid, token_expires_at: '2099-01-01T00:00:00Z' });
    await load('_lib/deliver-order.js').deliver('VK-2610-0001', { force: true });
    await check('force (แอดมินสั่งออกใหม่) -> ออกใหม่ทับได้ตามเดิม', () => {
      assert.notEqual(dbToken(), valid);
      assert.equal(mails[0], dbToken());
    });
    reset({ download_token: valid, token_expires_at: '2099-01-01T00:00:00Z' });
    await load('_lib/deliver-order.js').deliver('VK-2610-0001');
    await check('token ยังไม่หมดอายุ -> ใช้ตัวเดิม ไม่ออกใหม่', () => {
      assert.equal(dbToken(), valid);
      assert.equal(mails[0], valid);
    });
    reset({ status: 'pending' });
    c = await claim();
    await check('ยังไม่จ่าย -> หน้าขอบคุณไม่ออก token', () => {
      assert.equal(c.body.ready, false);
      assert.equal(dbToken(), null);
    });
  } finally { console.warn = ow; console.error = oe; }

  finished = true;
  console.log('\nToken race: ' + passed + ' passed, ' + failed + ' failed (no network)');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
