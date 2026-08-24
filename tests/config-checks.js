/* ============================================================
   ชุดตรวจ api/_lib/config.js และ /api/health

   รันด้วย:  node tests/config-checks.js
   ไม่ต้องมี key จริง ไม่แตะเครือข่าย (stub fetch ทั้งหมด)

   จุดประสงค์: พิสูจน์ว่า "ค่าที่ตั้งผิด" ดังทุกกรณีที่ระบุไว้
   ไม่ใช่แค่กรณีที่เรานึกออกตอนเขียนโค้ด
   ============================================================ */
'use strict';

const path = require('path');
const REPO = path.join(__dirname, '..');

/* ---- env ที่ถูกต้องทั้งหมด ใช้เป็นฐานแล้วค่อยแก้ทีละตัว ---- */
const GOOD = {
  SUPABASE_URL: 'https://snhfobhkrkuntohybnrh.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz012345',
  OMISE_SECRET_KEY: 'skey_test_abcdefghijklmnopqrst',
  OMISE_PUBLIC_KEY: 'pkey_test_abcdefghijklmnopqrst',
  APP_BASE_URL: 'https://vinko-quest.vercel.app',
  IP_HASH_SALT: 'a-long-random-salt-value'
};

function env(over) { return Object.assign({}, GOOD, over || {}); }

/* สร้าง JWT ปลอมสำหรับทดสอบ key แบบเดิม */
function mkJwt(claims) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return 'eyJ' + head.slice(3) + '.' + body + '.signature';
}

/* ---- ตัวนับผล ---- */
let pass = 0, failCount = 0;
function section(t) { console.log('\n' + t); }
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ผ่าน   ' + label); }
  else { failCount++; console.log('  ไม่ผ่าน ' + label + (detail ? '  -> ' + detail : '')); }
}

/* ต้อง set env ให้ถูกก่อน require config.js เพราะมันตรวจตอนโหลด */
Object.assign(process.env, GOOD);
process.env.HEALTH_TOKEN = 'health-token-for-testing-123456';

const config = require(path.join(REPO, 'api', '_lib', 'config.js'));

/** ช่วยหา error ที่พูดถึงตัวแปรตัวนี้ */
function errFor(result, name) {
  return result.errors.find(e => e.startsWith(name + ':')) || '';
}

/* ============================================================
   1. ตารางเคสตามไฟล์ 01 — ทุกข้อต้อง error พร้อมข้อความที่อ่านเข้าใจ
   ============================================================ */
section('1. ค่าที่ตั้งผิดต้องดังทันที');

let r = config.validate(env({ SUPABASE_URL: 'https://xxx.supabase.co/rest/v1/' }));
check('SUPABASE_URL มี /rest/v1/ -> บอกให้ตัด path',
      /rest\/v1/.test(errFor(r, 'SUPABASE_URL')) && /ตัด/.test(errFor(r, 'SUPABASE_URL')),
      errFor(r, 'SUPABASE_URL') || 'ไม่ error');

r = config.validate(env({ SUPABASE_URL: 'https://supabase.com/dashboard/project/xxx' }));
check('SUPABASE_URL เป็น URL dashboard -> บอกว่าใช้ผิดหน้า',
      /dashboard/.test(errFor(r, 'SUPABASE_URL')),
      errFor(r, 'SUPABASE_URL') || 'ไม่ error');

r = config.validate(env({ SUPABASE_URL: 'https://db.xxx.supabase.co' }));
check('SUPABASE_URL เป็น host ฐานข้อมูล -> บอกว่าไม่ใช่ API URL',
      /ฐานข้อมูล/.test(errFor(r, 'SUPABASE_URL')),
      errFor(r, 'SUPABASE_URL') || 'ไม่ error');

r = config.validate(env({ SUPABASE_URL: 'https://xxx.supabase.co/' }));
check('SUPABASE_URL มี / ปิดท้าย -> error',
      errFor(r, 'SUPABASE_URL') !== '', 'ไม่ error');

r = config.validate(env({ SUPABASE_SERVICE_ROLE_KEY: mkJwt({ role: 'anon' }) }));
check('ใส่ anon key -> บอกว่าจะติด RLS',
      /anon/.test(errFor(r, 'SUPABASE_SERVICE_ROLE_KEY')) &&
      /RLS|Row Level/.test(errFor(r, 'SUPABASE_SERVICE_ROLE_KEY')),
      errFor(r, 'SUPABASE_SERVICE_ROLE_KEY') || 'ไม่ error');

r = config.validate(env({ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_abcdef123456' }));
check('ใส่ sb_publishable_ -> บอกว่าเป็น key ฝั่ง client',
      /publishable/.test(errFor(r, 'SUPABASE_SERVICE_ROLE_KEY')),
      errFor(r, 'SUPABASE_SERVICE_ROLE_KEY') || 'ไม่ error');

r = config.validate(env({
  SUPABASE_SERVICE_ROLE_KEY: mkJwt({ role: 'service_role', exp: Math.floor(Date.now() / 1000) - 60 })
}));
check('service_role JWT ที่หมดอายุแล้ว -> error',
      /หมดอายุ/.test(errFor(r, 'SUPABASE_SERVICE_ROLE_KEY')),
      errFor(r, 'SUPABASE_SERVICE_ROLE_KEY') || 'ไม่ error');

r = config.validate(env({ OMISE_SECRET_KEY: 'pkey_test_abcdefghijkl' }));
check('OMISE_SECRET_KEY เป็น pkey_ -> บอกว่าใส่สลับกัน',
      /สลับ/.test(errFor(r, 'OMISE_SECRET_KEY')),
      errFor(r, 'OMISE_SECRET_KEY') || 'ไม่ error');

r = config.validate(env({ OMISE_PUBLIC_KEY: 'skey_test_abcdefghijkl' }));
check('OMISE_PUBLIC_KEY เป็น skey_ -> เตือนว่า secret จะหลุดสู่สาธารณะ',
      /revoke|หลุด/.test(errFor(r, 'OMISE_PUBLIC_KEY')),
      errFor(r, 'OMISE_PUBLIC_KEY') || 'ไม่ error');

r = config.validate(env({ RESEND_API_KEY: 'sk_live_wrongprefix' }));
check('RESEND_API_KEY ไม่ขึ้นต้น re_ -> error',
      errFor(r, 'RESEND_API_KEY') !== '', 'ไม่ error');

r = config.validate(env({ APP_BASE_URL: 'https://vinko.quest/' }));
check('APP_BASE_URL มี / ปิดท้าย -> error (ลิงก์ในอีเมลจะกลายเป็น //)',
      errFor(r, 'APP_BASE_URL') !== '', 'ไม่ error');

r = config.validate(env({ APP_BASE_URL: 'http://vinko.quest' }));
check('APP_BASE_URL เป็น http:// -> error',
      errFor(r, 'APP_BASE_URL') !== '', 'ไม่ error');

r = config.validate(env({ LAUNCH_PROMO_END: '30 กันยายน 2026' }));
check('LAUNCH_PROMO_END อ่านเป็นวันที่ไม่ได้ -> error ไม่ปล่อยให้เงียบ',
      errFor(r, 'LAUNCH_PROMO_END') !== '', 'ไม่ error');

r = config.validate(env({ STORY_DELIVERY_DATES: '2026-10-15,15/11/2026' }));
check('STORY_DELIVERY_DATES มีรูปแบบผิดปน -> error',
      errFor(r, 'STORY_DELIVERY_DATES') !== '', 'ไม่ error');

r = config.validate(env({ ADMIN_SECRET: 'sunkhun' }));
check('ADMIN_SECRET สั้นกว่า 16 ตัว -> error',
      errFor(r, 'ADMIN_SECRET') !== '', 'ไม่ error');

/* ============================================================
   2. ค่าที่ถูกต้องต้องผ่านทั้งสองรูปแบบ
   ============================================================ */
section('2. ค่าที่ถูกต้องต้องผ่าน');

r = config.validate(env());
check('ครบถูกหมดแบบ sb_secret_ -> ไม่มี error', r.errors.length === 0, r.errors.join(' | '));
check('รู้ว่าเป็น key แบบใหม่', r.supabaseKeyKind === 'secret', String(r.supabaseKeyKind));
check('ไม่มีตัวไหนขาด', r.missing.length === 0, r.missing.join(', '));

r = config.validate(env({ SUPABASE_SERVICE_ROLE_KEY: mkJwt({ role: 'service_role' }) }));
check('ครบถูกหมดแบบ legacy service_role JWT -> ไม่มี error', r.errors.length === 0, r.errors.join(' | '));
check('รู้ว่าเป็น key แบบเดิม', r.supabaseKeyKind === 'legacy', String(r.supabaseKeyKind));
check('เตือนเรื่องเลิกรองรับสิ้นปี 2026',
      r.warnings.some(w => /2026/.test(w)), r.warnings.join(' | '));

r = config.validate(env({ RESEND_API_KEY: 're_abcdef123456' }));
check('RESEND_API_KEY ที่ถูกต้อง -> ผ่าน', r.errors.length === 0, r.errors.join(' | '));

/* ============================================================
   3. ค่าที่ขาด -> รายงานว่าขาด ไม่ใช่ error รูปแบบ
   ============================================================ */
section('3. แยก "ขาด" ออกจาก "ผิดรูปแบบ"');

r = config.validate({});
check('env ว่างเปล่า -> ไม่มี error รูปแบบ', r.errors.length === 0, r.errors.join(' | '));
check('env ว่างเปล่า -> รายงานว่าขาดครบทุกตัวที่จำเป็น',
      ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OMISE_SECRET_KEY',
       'OMISE_PUBLIC_KEY', 'APP_BASE_URL'].every(n => r.missing.includes(n)),
      r.missing.join(', '));
check('ไม่ตั้ง IP_HASH_SALT -> เตือน',
      r.warnings.some(w => /IP_HASH_SALT/.test(w)), r.warnings.join(' | '));

r = config.validate(Object.assign({}, GOOD, { LINE_CHANNEL_ACCESS_TOKEN: 'abc' }));
check('ตั้ง LINE_CHANNEL_ACCESS_TOKEN แต่ไม่ตั้ง LINE_ADMIN_USER_ID -> เตือน',
      r.warnings.some(w => /LINE_CHANNEL_ACCESS_TOKEN/.test(w)), r.warnings.join(' | '));

r = config.validate(Object.assign({}, GOOD,
      { LINE_CHANNEL_ACCESS_TOKEN: 'abc', LINE_ADMIN_USER_ID: 'Uxxxx' }));
check('ตั้งครบทั้งคู่ -> ไม่เตือนเรื่อง LINE',
      !r.warnings.some(w => /LINE_CHANNEL_ACCESS_TOKEN/.test(w)), r.warnings.join(' | '));

/* ============================================================
   4. รวมทุกข้อในครั้งเดียว ไม่ใช่บอกทีละข้อ
   ============================================================ */
section('4. บอกทุกปัญหาพร้อมกัน');

r = config.validate({
  SUPABASE_URL: 'https://xxx.supabase.co/rest/v1/',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_xyz',
  OMISE_SECRET_KEY: 'pkey_test_xyz',
  OMISE_PUBLIC_KEY: 'skey_test_xyz',
  APP_BASE_URL: 'http://vinko.quest/'
});
check('ผิด 5 ที่ -> ได้ error ครบ 5 ข้อในรอบเดียว', r.errors.length === 5,
      'ได้ ' + r.errors.length + ' ข้อ: ' + r.errors.join(' | '));

/* ============================================================
   5. ห้ามมีค่า key จริงหลุดออกมาในข้อความ error
   ============================================================ */
section('5. ข้อความ error ต้องไม่พาค่า key ออกมา');

const SECRET = 'sb_publishable_SUPERSECRETVALUE0123456789';
r = config.validate(env({ SUPABASE_SERVICE_ROLE_KEY: SECRET }));
const allText = r.errors.concat(r.warnings).join(' ');
check('ไม่มีค่า key เต็มๆ ในข้อความ', !allText.includes(SECRET), allText);
check('ไม่มีท่อนท้ายของ key ในข้อความ', !allText.includes('SUPERSECRET'), allText);

check('mask() ตัดเหลือ 8 ตัวแรก + ความยาว',
      config.mask('sb_secret_1234567890') === 'sb_secre… (ยาว 20 ตัว)',
      config.mask('sb_secret_1234567890'));
check('mask() ค่าว่างไม่พัง', config.mask('') === '(ว่าง)', config.mask(''));

/* ============================================================
   6. /api/health
   ============================================================ */
section('6. /api/health');

function mockRes() {
  const o = { statusCode: 0, headers: {}, body: null };
  o.setHeader = (k, v) => { o.headers[k.toLowerCase()] = v; };
  o.status = (c) => { o.statusCode = c; return o; };
  o.send = (b) => { try { o.body = JSON.parse(b); } catch (e) { o.body = b; } return o; };
  return o;
}
function get(url) { return { method: 'GET', url: url, headers: {} }; }

const realFetch = global.fetch;
let nextPing = { ok: true, status: 200, contentRange: '0-0/7' };
global.fetch = async function () {
  return {
    ok: nextPing.ok,
    status: nextPing.status,
    headers: { get: k => (k.toLowerCase() === 'content-range' ? nextPing.contentRange : null) },
    text: async () => '',
    json: async () => ({})
  };
};

const health = require(path.join(REPO, 'api', 'health.js'));

(async () => {
  let res = mockRes();
  await health(get('/api/health'), res);
  check('ไม่ใส่ token -> 404 (ไม่บอกว่ามี endpoint นี้อยู่)', res.statusCode === 404, String(res.statusCode));

  res = mockRes();
  await health(get('/api/health?token=wrong-token-value-xxxxxxxx'), res);
  check('token ผิด -> 404', res.statusCode === 404, String(res.statusCode));

  const OK_URL = '/api/health?token=' + process.env.HEALTH_TOKEN;

  res = mockRes();
  await health(get(OK_URL), res);
  check('token ถูก + ทุกอย่างพร้อม -> 200', res.statusCode === 200,
        String(res.statusCode) + ' ' + JSON.stringify(res.body).slice(0, 200));
  check('บอกว่า config ผ่าน', res.body.config.ok === true);
  check('บอกว่าต่อ Supabase ได้จริง', res.body.supabase.ok === true, JSON.stringify(res.body.supabase));
  check('บอกโหมด Omise ว่าเป็น test', res.body.omise_key_mode === 'test', String(res.body.omise_key_mode));
  check('เตือนว่ายังใช้ test key อยู่',
        res.body.notes.some(n => /test key/.test(n)), JSON.stringify(res.body.notes));

  const dump = JSON.stringify(res.body);
  check('response ไม่มีค่า secret key ใดๆ',
        !dump.includes(GOOD.SUPABASE_SERVICE_ROLE_KEY) && !dump.includes(GOOD.OMISE_SECRET_KEY) &&
        !/sb_secret_|skey_/.test(dump), dump.slice(0, 200));
  check('response ไม่มี HEALTH_TOKEN', !dump.includes(process.env.HEALTH_TOKEN));

  nextPing = { ok: false, status: 401, contentRange: '' };
  res = mockRes();
  await health(get(OK_URL), res);
  check('Supabase ปฏิเสธ key -> 503 ไม่ใช่ 200', res.statusCode === 503, String(res.statusCode));
  check('บอกใบ้ให้ Redeploy เมื่อเจอ 401',
        /Redeploy/.test(res.body.supabase.hint || ''), JSON.stringify(res.body.supabase));

  nextPing = { ok: true, status: 200, contentRange: '0-0/7' };

  // ไม่ตั้ง HEALTH_TOKEN = endpoint ต้องหายไปเลย
  const savedToken = process.env.HEALTH_TOKEN;
  delete process.env.HEALTH_TOKEN;
  res = mockRes();
  await health(get(OK_URL), res);
  check('ไม่ตั้ง HEALTH_TOKEN -> endpoint ปิดตัวเอง 404', res.statusCode === 404, String(res.statusCode));
  process.env.HEALTH_TOKEN = savedToken;

  global.fetch = realFetch;

  console.log('\n========================================================');
  console.log('ผ่าน ' + pass + ' / ไม่ผ่าน ' + failCount);
  console.log('========================================================');
  process.exit(failCount ? 1 : 0);
})();
