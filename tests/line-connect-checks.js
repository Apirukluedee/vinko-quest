/* ============================================================
   ชุดตรวจ LINE: เข้าสู่ระบบอัตโนมัติเมื่อเปิดจากแอป LINE + QR ผูก LINE บนหน้าขอบคุณ

   รันด้วย:  node tests/line-connect-checks.js
   ไม่ยิงเครือข่าย ไม่ต้องมี key จริง — fetch ถูก stub ทั้งหมด
   สคริปต์ของ login.html / thank-you.js รันใน VM แยก

   ครอบคลุม:
   1. login.html — เปิดจากแอป LINE (openExternalBrowser=1) พาไป LINE Login เอง
      และไม่ทำในกรณีที่ไม่ควร (เปิดตรง, error, ออกจากระบบ, รอกรอกอีเมล,
      กลับมาซ้ำในแท็บเดิม, sessionStorage ใช้ไม่ได้)
   2. claim-download — คืนลิงก์/QR ผูก LINE เฉพาะคนที่ผ่านด่าน rid + paid
   3. thank-you.js — แสดงกล่อง QR เมื่อมีข้อมูล, ไม่แสดงเมื่อไม่มี
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const REPO = path.join(__dirname, '..');

let passed = 0, failed = 0, finished = false;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '  → ' + (e && e.message)); }
}
function section(t) { console.log('\n' + t); }
const tick = () => new Promise(r => setTimeout(r, 10));
process.on('exit', () => {
  if (!finished) { console.log('\nFAIL  ชุดทดสอบไม่จบ — ' + passed + ' passed ก่อนค้าง'); process.exitCode = 1; }
});

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const LINE_IAB = SAFARI.replace('Safari/604.1', 'Safari Line/14.12.0');
const AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize?fixture=1';

/* ---------------- 1. login.html ---------------- */
const loginSrc = (function () {
  const html = fs.readFileSync(path.join(REPO, 'login.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  return blocks[blocks.length - 1];
})();

async function loginPage({ search = '', ua = SAFARI, session = {}, blockedSession = false, callbackReply = { ok: true }, startReply = null } = {}) {
  const fetches = [], els = {};
  const el = () => ({ disabled: false, textContent: '', className: '', style: {}, value: '', addEventListener() {} });
  ['msg-box', 'btn-line', 'btn-magic', 'email-input'].forEach(id => { els[id] = el(); });
  const loc = { search, origin: 'https://vinko.quest', pathname: '/login', href: 'https://vinko.quest/login' + search, replaced: null,
    replace(u) { this.replaced = u; } };
  const store = {
    getItem(k) { if (blockedSession) throw Error('blocked'); return k in session ? session[k] : null; },
    setItem(k, v) { if (blockedSession) throw Error('blocked'); session[k] = String(v); },
    removeItem(k) { if (blockedSession) throw Error('blocked'); delete session[k]; }
  };
  const c = {
    navigator: { userAgent: ua }, location: loc, URLSearchParams, sessionStorage: store, Date, JSON, Number, String,
    document: { getElementById: id => els[id] }, history: { replaceState() {} }, console,
    fetch: async (url, opts) => {
      fetches.push({ url: String(url), opts });
      if (String(url).startsWith('/api/auth/line-start')) return { json: async () => (startReply || { ok: true, authorizeUrl: AUTH_URL }) };
      if (String(url).startsWith('/api/auth/line-callback')) return { json: async () => callbackReply };
      return { json: async () => ({ ok: true }) };
    }
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(loginSrc, c);
  await tick();
  return { c, loc, fetches, els, session, starts: () => fetches.filter(f => f.url.startsWith('/api/auth/line-start')) };
}

(async function run() {
  section('1. login.html — เปิดจากแอป LINE แล้วพาไป LINE Login ให้เอง');

  let p = await loginPage({ search: '?openExternalBrowser=1' });
  await check('มาจากแอป LINE (openExternalBrowser=1) -> เรียก line-start และไปหน้า LINE Login เอง', () => {
    assert.equal(p.starts().length, 1);
    assert.equal(p.starts()[0].url, '/api/auth/line-start');
    assert.equal(p.loc.href, AUTH_URL);
    assert.match(p.els['msg-box'].textContent, /กำลังพาไปเข้าสู่ระบบด้วย LINE/);
  });
  const sameTab = p.session;
  p = await loginPage({ search: '?openExternalBrowser=1', session: sameTab });
  await check('กด Back กลับมาในแท็บเดิมภายใน 10 นาที -> ไม่ดีดซ้ำ (ไม่ติดวน)', () => {
    assert.equal(p.starts().length, 0);
    assert.equal(p.loc.href, 'https://vinko.quest/login?openExternalBrowser=1');
  });
  p = await loginPage({ search: '?openExternalBrowser=1', session: { vnk_line_auto_at: String(Date.now() - 11 * 60 * 1000) } });
  await check('ผ่านไปเกิน 10 นาทีในแท็บเดิม -> พาไปได้อีกครั้ง', () => assert.equal(p.starts().length, 1));

  for (const [label, search, session] of [
    ['เปิด /login ตรงๆ (ไม่ได้มาจาก LINE)', '', {}],
    ['LINE ส่ง error กลับมา (กดยกเลิก)', '?error=access_denied&state=x&openExternalBrowser=1', {}],
    ['เพิ่งออกจากระบบ', '?logged_out=1&openExternalBrowser=1', {}],
    ['กำลังรอกรอกอีเมล (need_email)', '?openExternalBrowser=1', { vnk_need_email_line_uid_token: 'signed-fixture' }]
  ]) {
    p = await loginPage({ search, session });
    await check(label + ' -> ไม่พาไปเอง', () => assert.equal(p.starts().length, 0));
  }

  p = await loginPage({ search: '?openExternalBrowser=1', blockedSession: true });
  await check('sessionStorage ใช้ไม่ได้ -> ไม่พาไปเอง ไม่ error ปุ่มยังใช้ได้', () => {
    assert.equal(p.starts().length, 0);
    assert.equal(typeof p.c.beginLineLogin, 'function');
  });

  p = await loginPage({ search: '?code=abc&state=signed' });
  await check('กลับมาจาก LINE พร้อม code -> ส่ง code ไป line-callback ไม่เริ่ม LINE Login ใหม่', () => {
    assert.equal(p.starts().length, 0);
    assert.equal(p.fetches.filter(f => f.url === '/api/auth/line-callback').length, 1);
  });

  p = await loginPage({ search: '?connect_token=tok.sig&openExternalBrowser=1' });
  await check('ลิงก์ "เชื่อมบัญชี LINE" -> พาไป LINE Login เองพร้อม connect_token', () => {
    assert.equal(p.starts().length, 1);
    assert.equal(p.starts()[0].url, '/api/auth/line-start?connect_token=tok.sig');
    assert.equal(p.loc.href, AUTH_URL);
  });

  p = await loginPage({ search: '', ua: LINE_IAB });
  await check('เบราว์เซอร์ในแอป LINE -> ดีดออกเบราว์เซอร์จริงก่อน (เหมือนเดิม) ยังไม่เริ่ม LINE Login', () => {
    assert.equal(p.loc.replaced, 'https://vinko.quest/login?openExternalBrowser=1');
    assert.equal(p.fetches.length, 0);
  });

  /* ---------------- 2. claim-download ---------------- */
  section('2. claim-download — ลิงก์/QR ผูก LINE บนหน้าขอบคุณ');
  Object.assign(process.env, {
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service_FAKE',
    OMISE_SECRET_KEY: 'skey_test_FAKE', APP_BASE_URL: 'https://vinko.quest',
    LINE_LOGIN_CHANNEL_ID: '1234567890', LINE_LOGIN_CHANNEL_SECRET: 'line-secret-fixture',
    IP_HASH_SALT: 'test-salt-fixture', RESEND_API_KEY: 're_FAKE', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_FAKEFAKEFAKEFAKE'
  });
  const DB = { orders: [], order_items: [] };
  const reply = (status, body) => ({ ok: status < 300, status, headers: { get: () => null },
    text: async () => JSON.stringify(body), json: async () => body });
  global.fetch = async (url, opts) => {
    const u = String(url), method = ((opts && opts.method) || 'GET').toUpperCase();
    if (u.startsWith('https://fake.supabase.co/rest/v1/')) {
      const [p2, qs] = u.slice('https://fake.supabase.co/rest/v1/'.length).split('?');
      const f = [...new URLSearchParams(qs || '')].filter(([k]) => !['select', 'limit', 'order'].includes(k))
        .map(([k, v]) => [k, v.replace(/^eq\./, '')]);
      const rows = (DB[p2] || []).filter(r => f.every(([k, v]) => String(r[k]) === v));
      if (method === 'GET') return reply(200, rows);
      if (method === 'PATCH') { rows.forEach(r => Object.assign(r, JSON.parse(opts.body))); return reply(200, rows); }
    }
    throw new Error('unmocked fetch ' + method + ' ' + u);
  };
  const order = (extra) => Object.assign({ id: 'o1', order_ref: 'VK-2610-0001', status: 'paid', client_request_id: 'rid-0123456789abcdef',
    download_token: 'TOKEN_FIXTURE', token_expires_at: '2027-01-01T00:00:00Z', amount_satang: 19900, currency: 'THB',
    package_code: 'LAB', omise_charge_id: 'chrg_test_1', customer_email: 'Parent@Example.com' }, extra);
  async function claim(rid) {
    for (const f of ['claim-download.js', '_lib/email.js', '_lib/config.js']) delete require.cache[require.resolve(path.join(REPO, 'api', f))];
    const res = { statusCode: 200, headers: {}, body: null };
    res.setHeader = () => {}; res.status = s => { res.statusCode = s; return res; };
    res.send = b => { res.body = JSON.parse(b); return res; };
    await require(path.join(REPO, 'api', 'claim-download.js'))({ method: 'POST', headers: {}, body: { order_ref: 'VK-2610-0001', client_request_id: rid } }, res);
    return res;
  }

  DB.orders = [order()];
  let r = await claim('rid-0123456789abcdef');
  await check('จ่ายแล้ว + rid ตรง -> มี connect_line_url และ QR (SVG)', () => {
    assert.equal(r.body.ready, true);
    assert.match(r.body.connect_line_url, /^https:\/\/vinko\.quest\/login\?connect_token=[^&]+&openExternalBrowser=1$/);
    assert.match(r.body.connect_line_qr_svg, /^<svg[\s\S]*<\/svg>\s*$/);
  });
  await check('connect_token ผูกกับอีเมลของออเดอร์นี้ (ตรวจลายเซ็นด้วย secret ได้)', () => {
    const tok = decodeURIComponent(r.body.connect_line_url.match(/connect_token=([^&]+)/)[1]);
    const signed = require(path.join(REPO, 'api', '_lib', 'signed_token.js'));
    const payload = signed.verify(tok, 'line-secret-fixture');
    assert.equal(payload.p, 'connect');
    assert.equal(payload.email, 'parent@example.com');
    assert.ok(payload.exp > Date.now());
    // QR บนหน้าเว็บอยู่ได้ 30 นาที (แคปไปแชร์ทีหลังใช้ไม่ได้)
    assert.ok(payload.exp <= Date.now() + 30 * 60 * 1000 + 5000, 'page QR must expire within 30 min');
    assert.ok(payload.exp > Date.now() + 29 * 60 * 1000);
  });
  r = await claim('rid-WRONG-0000000000');
  await check('rid ไม่ตรง -> 403 ไม่มีลิงก์ผูก LINE', () => {
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.connect_line_url, undefined);
  });
  DB.orders = [order({ status: 'pending' })];
  r = await claim('rid-0123456789abcdef');
  await check('ยังไม่จ่าย -> ไม่มีลิงก์ผูก LINE', () => {
    assert.equal(r.body.ready, false);
    assert.equal(r.body.connect_line_url, undefined);
  });
  DB.orders = [order()];
  delete process.env.LINE_LOGIN_CHANNEL_SECRET;
  r = await claim('rid-0123456789abcdef');
  await check('ยังไม่ได้ตั้ง LINE Login -> ไม่มีกล่อง แต่ลิงก์ดาวน์โหลดยังได้', () => {
    assert.equal(r.body.ready, true);
    assert.equal(r.body.connect_line_url, undefined);
  });
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'line-secret-fixture';

  /* ---------------- 3. thank-you.js ---------------- */
  section('3. thank-you.js — แสดงกล่อง QR');
  async function thankYou(payload) {
    const els = {};
    const el = () => ({ hidden: true, textContent: '', innerHTML: '', href: '', parentNode: { insertBefore() {} },
      querySelector: () => null, addEventListener(n, f) { this['on' + n] = f; } });
    ['[data-vk-ty-loading]', '[data-vk-ty-ready]', '[data-vk-ty-email]', '[data-vk-ty-link]', '[data-vk-ty-expires]',
     '[data-vk-ty-ref-box]', '[data-vk-ty-ref]', '[data-vk-ty-line]', '[data-vk-ty-line-qr]', '[data-vk-ty-line-copy]']
      .forEach(s => { els[s] = el(); });
    els['[data-vk-ty-loading]'].hidden = false;
    const c = { document: { querySelector: s => els[s] || null, createElement: () => el() }, URLSearchParams, JSON, Date,
      location: { search: '?ref=VK-2610-0001' }, navigator: {}, console, setTimeout: () => {},
      sessionStorage: { getItem: () => JSON.stringify({ ref: 'VK-2610-0001', rid: 'rid-0123456789abcdef' }) },
      localStorage: { getItem: () => null, setItem() {} }, addEventListener() {},
      fetch: async () => ({ json: async () => payload }) };
    c.window = c;
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(REPO, 'assets/js/thank-you.js'), 'utf8'), c);
    await tick();
    return els;
  }
  let e = await thankYou({ ok: true, ready: true, download_url: '/download?token=X', connect_line_url: 'https://vinko.quest/login?connect_token=t&openExternalBrowser=1', connect_line_qr_svg: '<svg>qr</svg>' });
  await check('มีลิงก์ผูก LINE -> แสดงกล่องพร้อม QR', () => {
    assert.equal(e['[data-vk-ty-ready]'].hidden, false);
    assert.equal(e['[data-vk-ty-line]'].hidden, false);
    assert.equal(e['[data-vk-ty-line-qr]'].innerHTML, '<svg>qr</svg>');
  });
  e = await thankYou({ ok: true, ready: true, download_url: '/download?token=X' });
  await check('ไม่มีลิงก์ผูก LINE -> ซ่อนกล่อง ลิงก์ดาวน์โหลดยังแสดง', () => {
    assert.equal(e['[data-vk-ty-ready]'].hidden, false);
    assert.equal(e['[data-vk-ty-line]'].hidden, true);
  });
  await check('thank-you.html มีกล่อง QR และการ์ด EF อยู่ท้ายหน้า', () => {
    const html = fs.readFileSync(path.join(REPO, 'thank-you.html'), 'utf8');
    const box = html.indexOf('data-vk-ty-line hidden');
    const ef = html.indexOf('class="vk-line-cta"');
    assert.ok(box > 0, 'no LINE connect box');
    assert.ok(ef > box, 'EF card should come after the LINE connect box');
  });

  /* ---------------- 4. auth.js — เพดาน 3 LINE ต่ออีเมล + อายุ ---------------- */
  section('4. เพดาน LINE ต่ออีเมล, อายุลิงก์และการเข้าสู่ระบบ');
  const signed = require(path.join(REPO, 'api', '_lib', 'signed_token.js'));
  const SECRET = 'line-secret-fixture';
  const BUYER = 'parent@example.com';
  const uid = n => 'U' + String(n).padStart(32, '0');
  const S = { sessions: [], profileUid: uid(9), lineEmail: '', failLookup: false, inserted: [] };
  global.fetch = async (url, opts) => {
    const u = String(url), method = ((opts && opts.method) || 'GET').toUpperCase();
    if (u === 'https://api.line.me/oauth2/v2.1/token') return reply(200, { access_token: 'at', id_token: 'idt' });
    if (u === 'https://api.line.me/v2/profile') return reply(200, { userId: S.profileUid });
    if (u === 'https://api.line.me/oauth2/v2.1/verify') return reply(200, { email: S.lineEmail });
    if (u.startsWith('https://fake.supabase.co/rest/v1/user_sessions')) {
      const qs = new URLSearchParams(u.split('?')[1] || '');
      if (method === 'GET') {
        if (S.failLookup && qs.get('line_user_id') === 'not.is.null') return reply(503, { code: 'PGRST000' });
        let rows = S.sessions;
        if ((qs.get('email') || '').startsWith('eq.')) rows = rows.filter(r => r.email === qs.get('email').slice(3));
        if (qs.get('line_user_id') === 'not.is.null') rows = rows.filter(r => r.line_user_id);
        else if (qs.get('line_user_id')) rows = rows.filter(r => r.line_user_id === qs.get('line_user_id').replace(/^eq\./, ''));
        if (qs.get('email') === 'not.is.null') rows = rows.filter(r => r.email);
        return reply(200, rows);
      }
      if (method === 'POST') {
        const row = Object.assign({ session_token: 'sess-' + (S.sessions.length + 1) }, JSON.parse(opts.body));
        S.sessions.push(row); S.inserted.push(row);
        return reply(201, [row]);
      }
    }
    throw new Error('unmocked fetch ' + method + ' ' + u);
  };
  function loadAuth() {
    for (const f of ['auth.js', '_lib/sessions.js', '_lib/email.js', '_lib/config.js', '_lib/supabase.js']) delete require.cache[require.resolve(path.join(REPO, 'api', f))];
    return require(path.join(REPO, 'api', 'auth.js'));
  }
  function mres() {
    const res = { statusCode: 200, headers: {}, body: null };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; }; res.status = c => { res.statusCode = c; return res; };
    res.send = b => { res.body = JSON.parse(b); return res; }; res.end = () => res;
    return res;
  }
  const state = (extra) => signed.sign(Object.assign({ p: 'oauth', n: 'x', exp: Date.now() + 600000 }, extra), SECRET);
  async function callback(extra) {
    S.inserted = [];
    const res = mres();
    await loadAuth()({ method: 'POST', query: { action: 'line-callback' }, headers: {}, body: { code: 'c', state: state(extra) } }, res);
    return res;
  }
  const seed = ids => { S.sessions = ids.map((id, i) => ({ email: BUYER, line_user_id: id, session_token: 'old-' + i })); };
  const logs = []; const oe = console.error, ow = console.warn;
  console.error = (...a) => logs.push(a.join(' ')); console.warn = (...a) => logs.push(a.join(' '));
  try {
    seed([uid(1), uid(2)]); S.profileUid = uid(9);
    let r = await callback({ email: BUYER });
    await check('QR/ลิงก์ผูก: ผูกไว้ 2 บัญชี -> บัญชีที่ 3 ผูกได้ ได้ session', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
      assert.equal(S.inserted.length, 1);
      assert.equal(S.inserted[0].email, BUYER);
      assert.equal(S.inserted[0].line_user_id, uid(9));
    });
    seed([uid(1), uid(2), uid(3)]);
    r = await callback({ email: BUYER });
    await check('QR/ลิงก์ผูก: ครบ 3 บัญชีแล้ว -> บัญชีที่ 4 ถูกปฏิเสธ line_limit_reached ไม่สร้าง session', () => {
      assert.deepEqual(r.body, { ok: false, error: 'line_limit_reached' });
      assert.equal(S.inserted.length, 0);
      assert.equal(r.headers['set-cookie'], undefined);
    });
    await check('log ของการถูกปฏิเสธไม่มีอีเมลหรือ LINE id', () => {
      const all = logs.join('\n');
      assert.ok(all.includes('LINE_LIMIT_REACHED'));
      assert.ok(!all.includes(BUYER) && !all.includes(uid(9)));
    });
    seed([uid(1), uid(2), uid(3), uid(4)]); S.profileUid = uid(2);
    r = await callback({ email: BUYER });
    await check('LINE ที่ผูกไว้แล้วเข้าได้เสมอ แม้มีเกิน 3 บัญชี (ผูกก่อนมีกฎ)', () => {
      assert.equal(r.body.ok, true);
      assert.equal(S.inserted.length, 1);
    });
    S.sessions = [uid(1), uid(1), uid(1), uid(2)].map(id => ({ email: BUYER, line_user_id: id }))
      .concat([{ email: BUYER, line_user_id: null }, { email: 'other@example.com', line_user_id: uid(5) }]);
    S.profileUid = uid(9);
    r = await callback({ email: BUYER });
    await check('นับเฉพาะ LINE ไม่ซ้ำของอีเมลนี้ (session ซ้ำ / แถวไม่มี LINE / อีเมลอื่น ไม่นับ)', () => {
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
    });
    seed([uid(1), uid(2), uid(3)]); S.profileUid = uid(9); S.lineEmail = BUYER;
    r = await callback({});
    await check('LINE ที่ยืนยันอีเมลเดียวกับผู้ซื้อเอง (ไม่ได้มาจาก QR) -> ไม่ติดเพดาน', () => {
      assert.equal(r.body.ok, true);
      assert.equal(S.inserted[0].email, BUYER);
    });
    S.lineEmail = '';
    seed([uid(1), uid(2), uid(3)]); S.profileUid = uid(1);
    r = await callback({});
    await check('LINE ที่เคยผูกไว้ กดปุ่ม LINE ธรรมดา -> เข้าได้ตามเดิม', () => assert.equal(r.body.ok, true));
    seed([]); S.failLookup = true; S.profileUid = uid(9);
    r = await callback({ email: BUYER });
    S.failLookup = false;
    await check('นับจำนวนไม่ได้ (DB ล่ม) -> ไม่ผูก ตอบ internal', () => {
      assert.deepEqual(r.body, { ok: false, error: 'internal' });
      assert.equal(S.inserted.length, 0);
    });

    seed([]); S.profileUid = uid(9);
    r = await callback({ email: BUYER });
    await check('session ใหม่หมดอายุใน 1 ปี (ทั้งในฐานข้อมูลและ cookie)', () => {
      const exp = Date.parse(S.inserted[0].expires_at);
      const year = 365 * 24 * 3600 * 1000;
      assert.ok(Math.abs(exp - (Date.now() + year)) < 60000, 'expires_at ' + S.inserted[0].expires_at);
      assert.match(r.headers['set-cookie'], /Max-Age=31536000/);
      assert.match(r.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax/);
    });

    delete require.cache[require.resolve(path.join(REPO, 'api', '_lib', 'email.js'))];
    const emailLib = require(path.join(REPO, 'api', '_lib', 'email.js'));
    const mailUrl = emailLib.connectLineUrl(BUYER);
    const mailTok = signed.verify(decodeURIComponent(mailUrl.match(/connect_token=([^&]+)/)[1]), SECRET);
    await check('ลิงก์ผูก LINE ในอีเมลสั่งซื้อใช้ได้ 1 ปี', () => {
      assert.ok(Math.abs(mailTok.exp - (Date.now() + 365 * 24 * 3600 * 1000)) < 60000);
    });

    async function start(token) {
      const res = mres();
      await loadAuth()({ method: 'GET', query: { action: 'line-start', connect_token: token }, headers: {} }, res);
      return res;
    }
    r = await start(signed.sign({ p: 'connect', email: BUYER, exp: Date.now() - 1000 }, SECRET));
    await check('QR หมดอายุ -> line-start ตอบ connect_expired (ไม่ปล่อยไป login แบบไม่ผูก)', () => {
      assert.deepEqual(r.body, { ok: false, error: 'connect_expired' });
    });
    r = await start(signed.sign({ p: 'connect', email: BUYER, exp: Date.now() + 60000 }, 'wrong-secret'));
    await check('QR ปลอม (ลายเซ็นผิด) -> connect_expired', () => assert.equal(r.body.error, 'connect_expired'));
    r = await start(signed.sign({ p: 'oauth', email: BUYER, exp: Date.now() + 60000 }, SECRET));
    await check('token ผิดประเภท (ไม่ใช่ connect) -> connect_expired', () => assert.equal(r.body.error, 'connect_expired'));
    r = await start(signed.sign({ p: 'connect', email: BUYER, exp: Date.now() + 60000 }, SECRET));
    await check('QR ยังไม่หมดอายุ -> ได้ลิงก์ไป LINE Login พร้อมอีเมลใน state', () => {
      assert.equal(r.body.ok, true);
      const st = new URL(r.body.authorizeUrl).searchParams.get('state');
      assert.equal(signed.verify(st, SECRET).email, BUYER);
    });
    r = await start('');
    await check('ปุ่ม LINE ธรรมดา (ไม่มี connect_token) -> ทำงานเหมือนเดิม', () => assert.equal(r.body.ok, true));
  } finally { console.error = oe; console.warn = ow; }

  p = await loginPage({ search: '?code=abc&state=signed', callbackReply: { ok: false, error: 'line_limit_reached' } });
  await check('หน้า login แสดงข้อความ "ผูก LINE ครบ 3 บัญชีแล้ว" พร้อมทางออก (อีเมล/แอดมิน)', () => {
    assert.match(p.els['msg-box'].textContent, /ครบ 3 บัญชี/);
    assert.match(p.els['msg-box'].textContent, /อีเมล/);
  });
  p = await loginPage({ search: '?connect_token=old.tok&openExternalBrowser=1', startReply: { ok: false, error: 'connect_expired' } });
  await check('หน้า login แสดงข้อความ QR หมดอายุ บอกวิธีรับ QR ใหม่', () => {
    assert.match(p.els['msg-box'].textContent, /หมดอายุ/);
    assert.match(p.els['msg-box'].textContent, /QR ใหม่/);
  });

  finished = true;
  console.log('\nLINE connect: ' + passed + ' passed, ' + failed + ' failed (no network)');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
