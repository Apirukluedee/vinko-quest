/* ============================================================
   ชุดตรวจระบบส่งมอบไฟล์ (รอบ 3B)  —  node tests/delivery-checks.js

   stub Supabase / Supabase Storage / Resend ทั้งหมด
   ลายน้ำใช้ pdf-lib จริง แต่ใส่ลง PDF จำลองเล็กๆ ที่สร้างสดในเทสต์
   ============================================================ */
'use strict';

const path = require('path');
const REPO = path.join(__dirname, '..');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_TEST';
process.env.APP_BASE_URL = 'https://vinko.example';
process.env.IP_HASH_SALT = 'test-salt';
process.env.RESEND_API_KEY = 're_TEST';
process.env.INTERNAL_TASK_SECRET = 'task-secret-abcdefghijklmnop';
process.env.ADMIN_SECRET = 'admin-secret-abcdefghijklmnop';
process.env.CRON_SECRET = 'cron-secret-abcdefghijklmnop';
process.env.SELLER_NAME = 'VINKO WOW LAB';
process.env.CONTACT_EMAIL = 'hello@vinko.quest';
process.env.OMISE_SECRET_KEY = 'skey_test_FAKE';
process.env.OMISE_PUBLIC_KEY = 'pkey_test_FAKE';

/* ---------------- ฐานข้อมูลจำลอง ---------------- */
const DB = { orders: [], order_items: [], download_events: [], webhook_events: [], email_events: [] };
const STORAGE = new Set();              // product_code ที่มีไฟล์อยู่จริง
const SENT = [];                        // อีเมลที่ถูกส่งออกไป
const CHARGES = {};                     // charge ที่ Omise จะคืนให้ (id -> object)
const LINE_PUSHED = [];                 // ข้อความ LINE ที่ถูกยิงออกไป
let masterPdf = null;                   // PDF ต้นฉบับจำลอง

function reset() {
  for (const k of Object.keys(DB)) DB[k] = [];
  STORAGE.clear(); SENT.length = 0;
  for (const k of Object.keys(CHARGES)) delete CHARGES[k];
  LINE_PUSHED.length = 0;
}

const UNIQUE = { orders: ['order_ref', 'omise_charge_id', 'client_request_id', 'download_token'],
                 webhook_events: ['omise_event_id'] };

function filters(qs) {
  const out = [];
  for (const [k, v] of new URLSearchParams(qs || '')) {
    if (['select', 'limit', 'order'].includes(k)) continue;
    const m = /^(eq|gte|lte|is)\.(.*)$/.exec(v);
    if (m) out.push({ col: k, op: m[1], val: m[2] });
  }
  return out;
}
function match(row, fs) {
  return fs.every(f => {
    const v = row[f.col];
    if (f.op === 'is') return f.val === 'null' ? (v == null) : true;
    if (f.op === 'eq') return String(v) === f.val;
    if (f.op === 'gte') return new Date(v).getTime() >= new Date(f.val).getTime();
    if (f.op === 'lte') return String(v) <= f.val || new Date(v) <= new Date(f.val);
    return false;
  });
}
function reply(status, body, headers) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: k => (headers || {})[k.toLowerCase()] || null },
    text: async () => (body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))),
    json: async () => body,
    arrayBuffer: async () => (body instanceof Buffer ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)) };
}

global.fetch = async function (url, opts) {
  opts = opts || {};
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  if (u.startsWith('https://fake.supabase.co/storage/v1/object/')) {
    const code = u.split('/').pop().replace('.pdf', '');
    if (!STORAGE.has(code)) return reply(404, 'not found');
    return reply(200, masterPdf);
  }

  if (u.startsWith('https://fake.supabase.co/rest/v1')) {
    const [p, qs] = u.slice('https://fake.supabase.co/rest/v1'.length).split('?');
    const table = p.replace(/^\//, '');
    if (!DB[table]) return reply(404, { message: 'no table ' + table });

    if (method === 'POST') {
      const rows = [].concat(JSON.parse(opts.body));
      for (const r of rows) for (const c of UNIQUE[table] || [])
        if (r[c] != null && DB[table].some(x => x[c] === r[c]))
          return reply(409, { code: '23505' });
      const made = rows.map(r => Object.assign(
        { id: table + '-' + (DB[table].length + 1), created_at: new Date().toISOString() }, r));
      DB[table].push(...made);
      return reply(201, made);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const hit = DB[table].filter(r => match(r, filters(qs)));
      hit.forEach(r => Object.assign(r, patch));
      return reply(200, hit);
    }
    if (method === 'GET') return reply(200, DB[table].filter(r => match(r, filters(qs))));
    if (method === 'HEAD') {
      const n = DB[table].filter(r => match(r, filters(qs))).length;
      return reply(200, undefined, { 'content-range': '0-0/' + n });
    }
  }

  if (u === 'https://api.resend.com/emails') {
    const b = JSON.parse(opts.body);
    SENT.push(b);
    return reply(200, { id: 'msg_' + SENT.length });
  }

  // Omise: คืน charge ตามที่เทสต์ตั้งไว้ใน CHARGES
  if (u.startsWith('https://api.omise.co/charges/')) {
    const id = u.split('/').pop();
    const c = CHARGES[id];
    return c ? reply(200, c) : reply(404, { object: 'error', code: 'not_found' });
  }

  // LINE push
  if (u === 'https://api.line.me/v2/bot/message/push') {
    LINE_PUSHED.push(JSON.parse(opts.body));
    return reply(200, {});
  }

  throw new Error('unmocked fetch: ' + method + ' ' + u);
};

/* ---------------- req/res จำลอง ---------------- */
function mockRes() {
  const r = { statusCode: 200, headers: {}, body: null, raw: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => {
    r.raw = b;
    try { r.body = typeof b === 'string' ? JSON.parse(b) : (Buffer.isBuffer(b) ? null : b); }
    catch (e) { r.body = null; }
    return r;
  };
  return r;
}
const post = (body, headers) => ({ method: 'POST', url: '/', headers: Object.assign({ 'x-forwarded-for': '1.2.3.4' }, headers || {}), body, socket: {} });
const get = (url, headers) => ({ method: 'GET', url, headers: Object.assign({ 'x-forwarded-for': '1.2.3.4' }, headers || {}), socket: {} });

function load(rel) {
  const p = path.join(REPO, 'api', rel);
  Object.keys(require.cache).filter(k => k.includes(path.join(REPO, 'api'))).forEach(k => delete require.cache[k]);
  return require(p);
}

/* ---------------- ตัวช่วย ---------------- */
let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('  ผ่าน    ' + n))
                             : (fail++, console.log('  ไม่ผ่าน  ' + n + (d ? '  -> ' + d : '')));
const section = t => console.log('\n' + t);

function seedOrder(over) {
  const o = Object.assign({
    id: 'orders-1', order_ref: 'VK-2609-0001', status: 'paid',
    package_code: 'BUNDLE', customer_name: 'อภิรักษ์ ลือดี',
    customer_email: 'apirukluedee@gmail.com',
    client_request_id: 'rid-abcdefghijklmnop',
    download_token: null, token_expires_at: null,
    created_at: new Date().toISOString()
  }, over || {});
  DB.orders.push(o);
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const t = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  DB.order_items.push(
    { id: 'it-lab',  order_id: o.id, product_code: 'LAB-MAIN', title: 'VINKO WOW LAB', delivery_type: 'instant', scheduled_delivery_date: null, delivered_at: null },
    { id: 'it-s1',   order_id: o.id, product_code: 'STORY-01', title: 'นิทานเรื่องที่ 1', delivery_type: 'preorder', scheduled_delivery_date: y, delivered_at: null },
    { id: 'it-s2',   order_id: o.id, product_code: 'STORY-02', title: 'นิทานเรื่องที่ 2', delivery_type: 'preorder', scheduled_delivery_date: t, delivered_at: null }
  );
  return o;
}

(async () => {
  const { PDFDocument } = require(path.join(REPO, 'node_modules', 'pdf-lib'));
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText('VINKO test page', { x: 60, y: 500, size: 14 });
  masterPdf = Buffer.from(await d.save());

  /* ---- 1. token ---- */
  section('1. token ดาวน์โหลด');
  reset();
  const tk = require(path.join(REPO, 'api', '_lib', 'tokens.js'));
  const t1 = tk.newToken(), t2 = tk.newToken();
  check('ยาวอย่างน้อย 32 ตัวอักษร', t1.length >= 32, String(t1.length));
  check('สุ่มไม่ซ้ำกัน', t1 !== t2);
  check('ไม่ใช่รูปแบบ uuid ที่เดาง่าย', !/^[0-9a-f-]{36}$/.test(t1));

  /* ---- 2. download-info ---- */
  section('2. /api/download-info');
  reset(); const o1 = seedOrder();
  const token = await tk.issue(o1.id);
  let info = load('download-info.js'); let r = mockRes();
  await info(get('/api/download-info?token=' + token), r);
  check('token ถูกต้อง -> 200', r.statusCode === 200 && r.body.ok, JSON.stringify(r.body).slice(0, 90));
  check('คืน 3 รายการ', r.body.items.length === 3);
  check('LAB โหลดได้เลย', r.body.items.find(i => i.title === 'VINKO WOW LAB').released === true);
  check('นิทานที่ถึงกำหนดแล้วโหลดได้', r.body.items.find(i => i.title === 'นิทานเรื่องที่ 1').released === true);
  check('นิทานที่ยังไม่ถึงกำหนดโหลดไม่ได้', r.body.items.find(i => i.title === 'นิทานเรื่องที่ 2').released === false);
  check('ไม่คืนอีเมลลูกค้าออกมา', !JSON.stringify(r.body).includes('apirukluedee'), JSON.stringify(r.body).slice(0, 120));

  r = mockRes(); await info(get('/api/download-info?token=' + 'x'.repeat(43)), r);
  check('token มั่วๆ -> ปฏิเสธ', r.statusCode === 404 && !r.body.ok, String(r.statusCode));

  DB.orders[0].token_expires_at = new Date(Date.now() - 1000).toISOString();
  r = mockRes(); await info(get('/api/download-info?token=' + token), r);
  check('token หมดอายุ -> 410 พร้อมบอกให้ขอใหม่', r.statusCode === 410 && r.body.reason === 'expired');

  /* ---- 3. /api/download ---- */
  section('3. /api/download ส่งไฟล์จริง');
  reset(); const o2 = seedOrder();
  const tok2 = await tk.issue(o2.id);
  STORAGE.add('LAB-MAIN');
  let dl = load('download.js');

  r = mockRes(); await dl(get('/api/download?token=' + tok2 + '&item=it-lab'), r);
  check('โหลดสำเร็จ 200', r.statusCode === 200, String(r.statusCode) + ' ' + JSON.stringify(r.body));
  check('เป็น PDF', r.headers['content-type'] === 'application/pdf');
  check('เป็นไฟล์ที่ผ่านลายน้ำแล้ว (ใหญ่กว่าต้นฉบับ)', Buffer.isBuffer(r.raw) && r.raw.length > masterPdf.length);
  check('ชื่อไฟล์ไทยแบบ RFC 5987', /filename\*=UTF-8''/.test(r.headers['content-disposition'] || ''));
  check('ห้าม cache', /no-store/.test(r.headers['cache-control'] || ''));
  check('บันทึก download_events แล้ว', DB.download_events.length === 1);
  check('เก็บ IP เป็น hash ไม่ใช่ IP ดิบ',
        DB.download_events[0].ip_hash && !DB.download_events[0].ip_hash.includes('1.2.3.4'));

  r = mockRes(); await dl(get('/api/download?token=' + tok2 + '&item=it-s2'), r);
  check('ไฟล์ที่ยังไม่ถึงกำหนด -> ปฏิเสธ 403', r.statusCode === 403 && /ยังไม่ถึงกำหนด/.test(r.body.error));

  r = mockRes(); await dl(get('/api/download?token=' + tok2 + '&item=it-not-mine'), r);
  check('item ที่ไม่ใช่ของออเดอร์นี้ -> 404', r.statusCode === 404);

  r = mockRes(); await dl(get('/api/download?token=' + 'z'.repeat(43) + '&item=it-lab'), r);
  check('token เดามั่ว -> 403', r.statusCode === 403);

  STORAGE.delete('LAB-MAIN');
  r = mockRes(); await dl(get('/api/download?token=' + tok2 + '&item=it-lab'), r);
  check('ไฟล์ยังไม่มีใน storage -> 503 ไม่ใช่ 500', r.statusCode === 503);
  STORAGE.add('LAB-MAIN');

  /* ---- 4. จำกัดจำนวนครั้ง ---- */
  section('4. จำกัดดาวน์โหลด 10 ครั้งต่อไฟล์');
  reset(); const o3 = seedOrder(); const tok3 = await tk.issue(o3.id); STORAGE.add('LAB-MAIN');
  dl = load('download.js');
  let okCount = 0, blocked = 0, blockMsg = '';
  for (let i = 0; i < 11; i++) {
    const rr = mockRes();
    await dl(get('/api/download?token=' + tok3 + '&item=it-lab'), rr);
    if (rr.statusCode === 200) okCount++;
    else { blocked++; blockMsg = (rr.body && rr.body.error) || ''; }
  }
  check('โหลดได้ 10 ครั้ง', okCount === 10, 'ได้ ' + okCount);
  check('ครั้งที่ 11 ถูกปฏิเสธ', blocked === 1);
  check('บอกให้ติดต่อ ไม่ใช่บล็อกเงียบ', /ทักหาเรา|LINE|ติดต่อ/.test(blockMsg), blockMsg);

  /* ---- 5. deliver-order + อีเมล ---- */
  section('5. ส่งอีเมลยืนยันการสั่งซื้อ');
  reset(); const o4 = seedOrder({ download_token: null });
  let deliver = load('deliver-order.js');
  r = mockRes();
  await deliver(post({ order_ref: o4.order_ref }, { 'x-vinko-task': process.env.INTERNAL_TASK_SECRET }), r);
  check('ส่งสำเร็จ', r.statusCode === 200 && r.body.ok, JSON.stringify(r.body));
  check('ออก token ให้ออเดอร์แล้ว', !!DB.orders[0].download_token);
  check('ส่งอีเมล 1 ฉบับ', SENT.length === 1);
  check('มีทั้ง html และ text', SENT[0] && !!SENT[0].html && !!SENT[0].text);
  check('ไม่แนบไฟล์มากับอีเมล', SENT[0] && !SENT[0].attachments);
  check('มีลิงก์ /download ในอีเมล', /\/download\?token=/.test(SENT[0].html));
  check('บันทึก message id ลง email_events', DB.email_events.length === 1 && !!DB.email_events[0].provider_message_id);

  r = mockRes();
  await deliver(post({ order_ref: o4.order_ref }, { 'x-vinko-task': process.env.INTERNAL_TASK_SECRET }), r);
  check('เรียกซ้ำไม่ส่งอีเมลซ้ำ', SENT.length === 1, 'ส่งไป ' + SENT.length + ' ฉบับ');

  r = mockRes();
  await deliver(post({ order_ref: o4.order_ref }, { 'x-vinko-task': 'wrong' }), r);
  check('secret ผิด -> 401', r.statusCode === 401);
  r = mockRes(); await deliver(post({ order_ref: o4.order_ref }), r);
  check('ไม่มี secret -> 401', r.statusCode === 401);

  /* ---- 6. resend-link ---- */
  section('6. ขอลิงก์ใหม่');
  reset(); const o5 = seedOrder(); const tok5 = await tk.issue(o5.id);
  let rl = load('resend-link.js');
  r = mockRes();
  await rl(post({ token: tok5, email: 'attacker@evil.com' }), r);
  check('ส่งสำเร็จ', r.statusCode === 200 && r.body.ok, JSON.stringify(r.body));
  check('ส่งไปอีเมลเดิมเท่านั้น ไม่สนใจอีเมลที่แนบมา',
        SENT[0].to[0] === 'apirukluedee@gmail.com', JSON.stringify(SENT[0] && SENT[0].to));
  check('ออก token ใหม่ ไม่ใช่ตัวเดิม', DB.orders[0].download_token !== tok5);

  let limited = 0;
  for (let i = 0; i < 4; i++) {
    const rr = mockRes();
    await rl(post({ token: DB.orders[0].download_token }), rr);
    if (rr.statusCode === 429) limited++;
  }
  check('กดรัวถูกจำกัด', limited > 0, 'ถูกบล็อก ' + limited + ' ครั้ง');

  /* ---- 7. claim-download ---- */
  section('7. /api/claim-download สำหรับหน้า thank-you');
  reset(); const o6 = seedOrder(); await tk.issue(o6.id);
  let claim = load('claim-download.js');
  r = mockRes();
  await claim(post({ order_ref: o6.order_ref, client_request_id: o6.client_request_id }), r);
  check('ข้อมูลตรงกัน -> คืนลิงก์', r.statusCode === 200 && r.body.ready && /\/download\?token=/.test(r.body.download_url));

  r = mockRes();
  await claim(post({ order_ref: o6.order_ref, client_request_id: 'guessed-value-1234567' }), r);
  check('เดา client_request_id ไม่ได้ -> 403', r.statusCode === 403);
  check('ไม่มี token หลุดใน response', !/download_token|token=/.test(JSON.stringify(r.body)));

  /* ---- 8. admin resend ---- */
  section('8. /api/admin action=resend-email');
  reset(); const o7 = seedOrder(); await tk.issue(o7.id);
  let admin = load('admin.js');
  const ADM = { 'x-vinko-admin': process.env.ADMIN_SECRET };
  r = mockRes();
  await admin(post({ action: 'resend-email', order_ref: o7.order_ref }, ADM), r);
  check('มี secret -> ส่งซ้ำได้', r.statusCode === 200 && SENT.length === 1, JSON.stringify(r.body));
  r = mockRes();
  await admin(post({ action: 'resend-email', order_ref: o7.order_ref }, { 'x-vinko-admin': 'nope' }), r);
  check('secret ผิด -> 401', r.statusCode === 401);
  r = mockRes();
  await admin(post({ action: 'resend-email', order_ref: 'VK-9999-9999' }, ADM), r);
  check('ออเดอร์ไม่มีจริง -> ไม่ 500', r.statusCode === 400 && !r.body.ok, String(r.statusCode));
  r = mockRes(); await admin(post({ action: 'ลบทุกอย่าง' }, ADM), r);
  check('action ที่ไม่รู้จัก -> 400 ไม่ใช่ 500', r.statusCode === 400, String(r.statusCode));
  r = mockRes(); await admin(post({ action: 'test-line' }, { 'x-vinko-admin': 'nope' }), r);
  check('test-line ก็ต้องผ่าน secret เหมือนกัน', r.statusCode === 401, String(r.statusCode));

  /* ---- 9. cron ส่งนิทาน ---- */
  section('9. cron ส่งนิทานตามกำหนด');
  reset(); const o8 = seedOrder(); await tk.issue(o8.id);
  let cron = load('cron/deliver-preorders.js');

  r = mockRes(); await cron(get('/api/cron/deliver-preorders'), r);
  check('ไม่มี secret -> 401', r.statusCode === 401);

  const auth = { authorization: 'Bearer ' + process.env.CRON_SECRET };
  r = mockRes(); await cron(get('/api/cron/deliver-preorders', auth), r);
  check('ไฟล์ยังไม่มีใน storage -> ไม่ส่งอีเมล', SENT.length === 0 && r.body.skipped_no_file === 1,
        JSON.stringify(r.body));
  check('ไม่ตั้ง delivered_at ทั้งที่ยังไม่ได้ส่ง', DB.order_items.find(i => i.id === 'it-s1').delivered_at == null);

  STORAGE.add('STORY-01');
  r = mockRes(); await cron(get('/api/cron/deliver-preorders', auth), r);
  check('มีไฟล์แล้ว -> ส่งอีเมล 1 ฉบับ', SENT.length === 1 && r.body.sent === 1, JSON.stringify(r.body));
  check('ตั้ง delivered_at แล้ว', !!DB.order_items.find(i => i.id === 'it-s1').delivered_at);
  check('ไม่ส่งเรื่องที่ยังไม่ถึงกำหนด', !SENT.some(m => /เรื่องที่ 2/.test(m.subject)));

  r = mockRes(); await cron(get('/api/cron/deliver-preorders', auth), r);
  check('รันซ้ำไม่ส่งซ้ำ', SENT.length === 1, 'ส่งไป ' + SENT.length);

  /* ---- 10. webhook สั่งส่งมอบ ---- */
  section('10. webhook สั่งส่งมอบต่อ');
  reset();
  const o9 = seedOrder({ status: 'pending', omise_charge_id: 'chrg_x', download_token: null });
  DB.orders[0].amount_satang = 39900; DB.orders[0].currency = 'THB';
  const orders = require(path.join(REPO, 'api', '_lib', 'orders.js'));
  const out = await orders.applyChargeResult({
    id: 'chrg_x', status: 'successful', amount: 39900, currency: 'THB', source: { type: 'promptpay' }
  });
  check('ตั้งเป็น paid', DB.orders[0].status === 'paid');
  check('บอกว่าต้องส่งมอบต่อ', out.needs_delivery === true, JSON.stringify(out));

  const out2 = await orders.applyChargeResult({
    id: 'chrg_x', status: 'successful', amount: 39900, currency: 'THB', source: { type: 'promptpay' }
  });
  check('เรียกซ้ำไม่สั่งส่งมอบอีก', !out2.needs_delivery, JSON.stringify(out2));

  /* ---- 11. webhook ต้องทำงานให้เสร็จก่อนตอบ 200 ----
     Vercel หยุดฟังก์ชันทันทีที่ตอบ response งานที่ยิงทิ้งไว้แบบไม่ await
     จะถูกฆ่ากลางคัน ลูกค้าจ่ายเงินแล้วแต่ไม่มี token — เกิดขึ้นจริงกับ
     VK-2608-0001 แล้วเทสต์ชุดเดิมมองไม่เห็นเพราะ stub ตอบ ok ให้เฉยๆ
     เทสต์นี้จึงตรวจ "สถานะหลังตอบ 200" ไม่ใช่ "ถูกเรียกหรือยัง" */
  section('11. webhook ต้องส่งมอบเสร็จก่อนตอบ 200');
  reset();
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token-test';
  process.env.LINE_ADMIN_USER_ID = 'Utest0000000000000000000000000000';
  const o10 = seedOrder({ status: 'pending', omise_charge_id: 'chrg_wh', download_token: null });
  DB.orders[0].amount_satang = 39900; DB.orders[0].currency = 'THB';
  CHARGES['chrg_wh'] = { object: 'charge', id: 'chrg_wh', status: 'successful',
                         amount: 39900, currency: 'THB', source: { type: 'promptpay' } };

  const wh = load('omise-webhook.js');
  r = mockRes();
  await wh(post({ id: 'evnt_wh_1', key: 'charge.complete',
                  data: { object: 'charge', id: 'chrg_wh' } }), r);

  check('ตอบ 200 ให้ Omise', r.statusCode === 200, String(r.statusCode));
  check('ตั้งเป็น paid แล้ว', DB.orders[0].status === 'paid');
  check('ออก download_token แล้วตอนตอบ 200', !!DB.orders[0].download_token,
        'token = ' + DB.orders[0].download_token);
  check('ส่งอีเมลแล้วตอนตอบ 200', SENT.length === 1, 'ส่งไป ' + SENT.length + ' ฉบับ');
  check('แจ้งเตือน LINE แล้วตอนตอบ 200', LINE_PUSHED.length === 1,
        'ยิงไป ' + LINE_PUSHED.length + ' ข้อความ');
  check('ข้อความ LINE มีเลขที่ออเดอร์', LINE_PUSHED.length > 0 &&
        LINE_PUSHED[0].messages[0].text.includes(o10.order_ref),
        JSON.stringify(LINE_PUSHED[0] || null));

  r = mockRes();
  await wh(post({ id: 'evnt_wh_1', key: 'charge.complete',
                  data: { object: 'charge', id: 'chrg_wh' } }), r);
  check('event ซ้ำ -> ไม่ส่งอีเมลรอบสอง', SENT.length === 1, 'ส่งไป ' + SENT.length);

  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_ADMIN_USER_ID;

  /* ---- 12. claim-download กู้เองได้ถ้า webhook พลาด ---- */
  section('12. claim-download ออก token เองได้ถ้า webhook พลาด');
  reset();
  const o11 = seedOrder({ status: 'paid', download_token: null, token_expires_at: null });
  const claim2 = load('claim-download.js');
  r = mockRes();
  await claim2(post({ order_ref: o11.order_ref, client_request_id: o11.client_request_id }), r);
  check('คืนลิงก์ให้ได้ทั้งที่ webhook ไม่ได้ออก token', r.body.ready === true, JSON.stringify(r.body));
  check('บันทึก token ลงออเดอร์จริง', !!DB.orders[0].download_token);

  console.log('\n' + '='.repeat(56));
  console.log('ผ่าน ' + pass + ' / ไม่ผ่าน ' + fail);
  console.log('='.repeat(56));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nชุดทดสอบล้ม:', e); process.exit(1); });
