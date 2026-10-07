/* ============================================================
   ชุดตรวจ keepalive ฐานข้อมูล (/api/cron/keepalive -> /api/health?_route=keepalive)

   รันด้วย:  node tests/keepalive-checks.js
   ไม่ยิงเครือข่าย — fetch ถูก stub ทั้งหมด

   ครอบคลุม:
   1. vercel.json: มี cron รายวัน + rewrite ไปที่ health, function ไม่เกิน 12
   2. สิทธิ์: ต้องมี Bearer CRON_SECRET ที่ถูกต้อง
   3. ไม่ได้ตั้ง CRON_SECRET -> 503 + log ชัดเจน ไม่แตะฐานข้อมูล
   4. อ่านฐานข้อมูลจริง 1 ครั้ง ไม่คืนข้อมูลในตาราง
   5. ฐานข้อมูลพัง -> 502 + log แค่ status
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}

const SECRET = 'cron-secret-fixture-0123456789abcdef';
Object.assign(process.env, {
  SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FAKEFAKEFAKEFAKE',
  OMISE_SECRET_KEY: 'skey_test_FAKE', OMISE_PUBLIC_KEY: 'pkey_test_FAKE', APP_BASE_URL: 'https://vinko.quest',
  IP_HASH_SALT: 'salt-fixture', RESEND_API_KEY: 're_FAKE'
});

const calls = [];
let dbReply = { status: 200, body: [{ id: 'row-id-should-not-leak' }] };
global.fetch = async (url, opts) => {
  calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
  if (dbReply === 'throw') throw new Error('network down');
  return { ok: dbReply.status < 300, status: dbReply.status, headers: { get: () => null },
    text: async () => JSON.stringify(dbReply.body), json: async () => dbReply.body };
};

function load() {
  for (const f of ['health.js', '_lib/config.js', '_lib/supabase.js']) delete require.cache[require.resolve(path.join(REPO, 'api', f))];
  return require(path.join(REPO, 'api', 'health.js'));
}
async function hit(headers) {
  const res = { statusCode: 200, headers: {}, body: null };
  res.setHeader = () => {}; res.status = c => { res.statusCode = c; return res; };
  res.send = b => { res.body = JSON.parse(b); return res; };
  await load()({ method: 'GET', url: '/api/health?_route=keepalive', headers: headers || {} }, res);
  return res;
}

(async function run() {
  console.log('\n1. vercel.json');
  const vj = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  await check('มี cron /api/cron/keepalive วันละครั้ง (Hobby รันได้วันละครั้ง)', () => {
    const c = vj.crons.find(x => x.path === '/api/cron/keepalive');
    assert.ok(c, 'no keepalive cron');
    assert.match(c.schedule, /^\d+ \d+ \* \* \*$/);
  });
  await check('cron pre-order เดิมยังอยู่', () => assert.ok(vj.crons.some(x => x.path === '/api/cron/deliver-preorders')));
  await check('rewrite /api/cron/keepalive -> /api/health?_route=keepalive', () => {
    assert.ok(vj.rewrites.some(r => r.source === '/api/cron/keepalive' && r.destination === '/api/health?_route=keepalive'));
  });
  await check('ไม่ได้เพิ่ม Serverless Function (Vercel Hobby จำกัด 12)', () => {
    const files = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name.startsWith('_')) continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p);
      }
    })(path.join(REPO, 'api'));
    assert.ok(files.length <= 12, files.length + ' functions');
    assert.ok(!fs.existsSync(path.join(REPO, 'api', 'cron', 'keepalive.js')));
  });

  console.log('\n2-5. /api/health?_route=keepalive');
  const logs = []; const oe = console.error, ow = console.warn;
  console.error = (...a) => logs.push(a.join(' ')); console.warn = () => {};
  try {
    delete process.env.CRON_SECRET; calls.length = 0;
    let r = await hit({ authorization: 'Bearer anything' });
    await check('ไม่ได้ตั้ง CRON_SECRET -> 503 cron_secret_missing, log ชัดเจน, ไม่แตะฐานข้อมูล', () => {
      assert.equal(r.statusCode, 503);
      assert.equal(r.body.error, 'cron_secret_missing');
      assert.equal(calls.length, 0);
      assert.ok(logs.some(l => /\[vinko\]\[keepalive\] CRON_SECRET/.test(l)));
    });

    process.env.CRON_SECRET = SECRET;
    for (const [label, h] of [['ไม่มี header', {}], ['secret ผิด', { authorization: 'Bearer wrong' }], ['ไม่ใช่ Bearer', { authorization: SECRET }]]) {
      calls.length = 0;
      r = await hit(h);
      await check(label + ' -> 401 ไม่แตะฐานข้อมูล', () => { assert.equal(r.statusCode, 401); assert.equal(calls.length, 0); });
    }

    calls.length = 0; dbReply = { status: 200, body: [{ id: 'row-id-should-not-leak' }] };
    r = await hit({ authorization: 'Bearer ' + SECRET });
    await check('secret ถูก -> อ่านฐานข้อมูลจริง 1 ครั้ง (GET orders limit 1) ตอบ 200', () => {
      assert.equal(r.statusCode, 200);
      assert.deepEqual(r.body, { ok: true });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'GET');
      assert.match(calls[0].url, /^https:\/\/fake\.supabase\.co\/rest\/v1\/orders\?select=id&limit=1$/);
    });
    await check('response ไม่มีข้อมูลในตาราง', () => assert.ok(!JSON.stringify(r.body).includes('row-id')));

    logs.length = 0; dbReply = { status: 503, body: { message: 'paused project for x@example.com' } };
    r = await hit({ authorization: 'Bearer ' + SECRET });
    await check('ฐานข้อมูลตอบ error -> 502 + log แค่ status ไม่มีข้อความจาก DB', () => {
      assert.equal(r.statusCode, 502);
      assert.ok(logs.some(l => l.includes('status: 503')));
      assert.ok(!logs.join(' ').includes('example.com'));
    });
    logs.length = 0; dbReply = 'throw';
    r = await hit({ authorization: 'Bearer ' + SECRET });
    await check('เครือข่ายพัง -> 502 ไม่ throw', () => assert.equal(r.statusCode, 502));
    await check('log ไม่มีค่า CRON_SECRET', () => assert.ok(!logs.join(' ').includes(SECRET)));
  } finally { console.error = oe; console.warn = ow; }

  console.log('\nKeepalive: ' + passed + ' passed, ' + failed + ' failed (no network)');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
