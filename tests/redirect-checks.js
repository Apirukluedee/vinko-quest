/* ============================================================
   ตรวจ /r/:token — ลิงก์กลางของ QR บน X-stand

   จุดที่ต้องจับให้ได้ก่อน deploy:
   - QR พิมพ์แจกไปแล้วแก้ไม่ได้ ตารางผิด = คนหน้างานไปผิดที่
   - from=line ใน QR หน้างาน = ปล่อยไฟล์โดยไม่ได้เพื่อนกลับมา
   - open redirect = ใครก็เอาโดเมนเราไปพาคนไปเว็บหลอกลวงได้
   - 301 = เบราว์เซอร์จำถาวร ย้ายงานแล้วแก้ไม่ได้อีกเลย

   รัน: node tests/redirect-checks.js
   ============================================================ */
'use strict';

const path = require('path');
const REPO = path.join(__dirname, '..');
const act = require(path.join(REPO, 'api', '_lib', 'activations.js'));
const handler = require(path.join(REPO, 'api', 'redirect.js'));

let pass = 0, fail = 0;
function section(t) { console.log('\n' + t); }
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ผ่าน    ' + name); }
  else { fail++; console.log('  ไม่ผ่าน  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

function mockRes() {
  return {
    statusCode: 0, headers: {}, body: null, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.ended = true; this.body = b || null; }
  };
}
function hit(token, method, qs) {
  const r = mockRes();
  handler({ method: method || 'GET',
            url: '/api/redirect?token=' + encodeURIComponent(token) + (qs || '') }, r);
  return r;
}

/* ตัวจัดการที่ใช้ตารางจำลอง — ตรวจ "เส้นทางสำเร็จ" ได้โดยไม่ต้องเปิด token หน้างานจริง */
let fixtureHandler;
function hitFix(token, method, qs) {
  const r = mockRes();
  fixtureHandler({ method: method || 'GET',
                   url: '/api/redirect?token=' + encodeURIComponent(token) + (qs || '') }, r);
  return r;
}

/* ตารางจำลองที่ "ยืนยันแล้ว" — ใช้ทดสอบกลไกโดยไม่ต้องรอป้ายกำกับจริง
   ตารางจริงใน activations.js ยัง confirmed:false ทั้งหมด จึงต้อง 404 */
const FIXTURE = {
  'booth-a': [
    { activation_id: 'QR-XS-A-WEB-01__T21KORAT-2026-09__r01', active: false, confirmed: true,
      dest: '/', utm: { utm_source: 'offline', utm_medium: 'xstand', utm_campaign: 'old_event' } },
    { activation_id: 'QR-XS-A-WEB-01__T21KORAT-2026-09__r02', active: true, confirmed: true,
      dest: '/free-sample',
      utm: { utm_source: 'offline', utm_medium: 'xstand',
             utm_campaign: 't21korat_sep2026', utm_content: 'qr_xs_a_web_01' } }
  ]
};

/* ---- 1. ตารางจริง ---- */
section('1. ตารางจริงใน activations.js');
const v = act.validate();
check('ตารางผ่านการตรวจทั้งใบ', v.ok, v.errors.join(' | '));
// ไม่บังคับ "ต้องมีรอบ active เสมอ" อีกต่อไป — token ที่ retired ทั้งหมด
// (เช่น xstand-a-line ตั้งแต่ 9 ก.ย. 2026) มีรอบ active เป็น 0 ได้ตามปกติ
// กฎจริงคือ "active พร้อมกันได้ไม่เกิน 1 รอบ" ตามที่ validate() บังคับอยู่แล้ว
check('ทุก token มีรอบที่ active ไม่เกินหนึ่งรอบ',
      Object.keys(act.MAP).every(t => act.MAP[t].filter(r => r.active).length <= 1));
check('ทุกรอบระบุ confirmed เป็น boolean ชัดเจน',
      Object.keys(act.MAP).every(t => act.MAP[t].every(r => typeof r.confirmed === 'boolean')));

/* ---- 2. from=line ห้ามอยู่ใน QR หน้างาน ---- */
section('2. QR หน้างานต้องไม่ข้ามขั้น LINE');
let noFromLine = true;
Object.keys(act.MAP).forEach(t => act.MAP[t].forEach(r => {
  if (r.extra && r.extra.from === 'line') noFromLine = false;
}));
check('ไม่มีรอบไหนเติม from=line เลย', noFromLine);
check('validate() จับได้ถ้ามีใครเผลอใส่ from=line',
      !act.validate({ x: [{ activation_id: 'A__B__r01', active: true, confirmed: true,
                            dest: '/free-sample', utm: {}, extra: { from: 'line' } }] }).ok);
const okUrl = act.resolve('booth-a', FIXTURE).url;
check('ปลายทางที่สร้างออกมาไม่มี from=line', okUrl.indexOf('from=line') === -1, okUrl);

/* ---- 3. UTM ตามมาตรฐานที่ตกลงไว้ ---- */
section('3. UTM ตามมาตรฐาน');
const live = act.MAP['xstand-a-line'][0].utm;
check('utm_source = offline', live.utm_source === 'offline', live.utm_source);
check('utm_medium = xstand', live.utm_medium === 'xstand', live.utm_medium);
check('utm_campaign = t21korat_sep2026', live.utm_campaign === 't21korat_sep2026', live.utm_campaign);
check('utm_content = qr_xs_a_line_01', live.utm_content === 'qr_xs_a_line_01', live.utm_content);
check('ส่ง activation_id เป็น parameter ของเราเอง', /[?&]activation_id=/.test(okUrl), okUrl);
check('ไม่ใช้ utm_id (Google สงวนไว้เป็นรหัสแคมเปญ)', !/[?&]utm_id=/.test(okUrl), okUrl);
check('activation_id คงตัวพิมพ์ใหญ่',
      /activation_id=QR-XS-A-WEB-01__T21KORAT-2026-09__r02/.test(okUrl), okUrl);

/* ---- 4. รูปแบบ activation_id ---- */
section('4. รูปแบบ activation_id (QR_ID__EVENT_CODE__rNN)');
check('ตัวอย่างจากข้อตกลงผ่าน', act.ACTIVATION_RE.test('QR-XS-A-LINE-01__T21KORAT-2026-09__r01'));
check('ขาด round -> ไม่ผ่าน', !act.ACTIVATION_RE.test('QR-XS-A-LINE-01__T21KORAT-2026-09'));
check('round หลักเดียว -> ไม่ผ่าน', !act.ACTIVATION_RE.test('QR-A__EV__r1'));
check('ตัวพิมพ์เล็ก -> ไม่ผ่าน', !act.ACTIVATION_RE.test('qr-a__ev__r01'));

/* ---- 5. ยังไม่ยืนยัน = ต้อง 404 ---- */
section('5. ยังไม่ยืนยันป้ายกำกับ = ห้ามใช้งาน');
// xstand-a-line retired (active:false) แล้ว 9 ก.ย. 2026 — ไม่นับใน pending() อีกต่อไป
// เหลือแค่ xstand-a-website ที่ยัง active แต่รอยืนยันป้ายกำกับ
check('มีรายการรอยืนยันอยู่จริง', act.pending().length === 1, String(act.pending().length));
let r = hit('xstand-a-line');
check('token ที่ยังไม่ยืนยัน -> 404 ไม่ใช่ redirect', r.statusCode === 404, String(r.statusCode));
check('404 ไม่มี Location header', !r.headers.location);
check('404 มีลิงก์กลับหน้าแรก', /href="\/"/.test(r.body || ''));
check('404 ไม่ให้ search engine เก็บ', r.headers['x-robots-tag'] === 'noindex');
check('resolve() ปฏิเสธรายการที่ยังไม่ยืนยัน', act.resolve('xstand-a-line').found === false);
check('พอยืนยันแล้วถึงจะ redirect ได้', act.resolve('booth-a', FIXTURE).found === true);

/* ---- 5b. เส้นทางสำเร็จผ่านตัว handler จริง ---- */
section('5b. เส้นทางสำเร็จ (ตารางจำลองที่ยืนยันแล้ว)');
fixtureHandler = handler.createHandler(FIXTURE);

let f = hitFix('booth-a');
check('token ถูกต้อง -> 302', f.statusCode === 302, String(f.statusCode));
check('302 ไปปลายทางที่กำหนด', f.headers.location.indexOf('/free-sample?') === 0, f.headers.location);
check('แนบ utm ครบทั้ง 4 ฟิลด์',
      /utm_source=offline/.test(f.headers.location) &&
      /utm_medium=xstand/.test(f.headers.location) &&
      /utm_campaign=t21korat_sep2026/.test(f.headers.location) &&
      /utm_content=qr_xs_a_web_01/.test(f.headers.location), f.headers.location);
check('แนบ activation_id คงตัวพิมพ์ใหญ่',
      /activation_id=QR-XS-A-WEB-01__T21KORAT-2026-09__r02/.test(f.headers.location),
      f.headers.location);
check('ตอบ 302 ไม่ใช่ 301 (301 = ย้ายงานแล้วแก้ไม่ได้)', f.statusCode === 302);
check('no-store', f.headers['cache-control'] === 'no-store');

// พยายามสั่งเปลี่ยนปลายทางผ่าน query string ทุกรูปแบบ
const HIJACK = ['&dest=https://evil.com', '&url=//evil.com', '&redirect=/checkout',
                '&next=https%3A%2F%2Fevil.com', '&to=/admin', '&dest=/'];
let unchanged = true;
HIJACK.forEach(q => {
  const rr = hitFix('booth-a', 'GET', q);
  if (rr.headers.location !== f.headers.location) unchanged = false;
});
check('สั่งเปลี่ยนปลายทางผ่าน query ไม่ได้เลยสักแบบ', unchanged, f.headers.location);

check('token ที่ไม่มีในตารางจำลอง -> 404', hitFix('booth-zzz').statusCode === 404);
check('รอบที่ยังไม่ยืนยันในตารางจำลองก็ 404',
      handler.createHandler({ q: [{ activation_id: 'A__B__r01', active: true, confirmed: false,
                                    dest: '/', utm: {} }] }) &&
      (function () { const r2 = mockRes();
        handler.createHandler({ q: [{ activation_id: 'A__B__r01', active: true, confirmed: false,
                                      dest: '/', utm: {} }] })({ method: 'GET', url: '/api/redirect?token=q' }, r2);
        return r2.statusCode === 404; })());

/* ---- 6. ใช้รอบที่ active + เก็บประวัติ ---- */
section('6. รอบที่ใช้งานและประวัติ');
check('ใช้รอบที่ active เท่านั้น ไม่ใช่รอบเก่า',
      /utm_campaign=t21korat_sep2026/.test(okUrl) && !/old_event/.test(okUrl), okUrl);
check('เก็บประวัติรอบเก่าไว้ครบ', act.history('booth-a', FIXTURE).length === 2);
check('token ไม่รู้จัก -> ประวัติว่าง ไม่ throw', act.history('nope-123').length === 0);
const ids = [];
Object.keys(act.MAP).forEach(t => act.MAP[t].forEach(x => ids.push(x.activation_id)));
check('activation_id ไม่ซ้ำกันทั้งระบบ', new Set(ids).size === ids.length);

/* ---- 7. token ไม่รู้จัก / open redirect ---- */
section('7. token ไม่รู้จัก และ open redirect');
const EVIL = ['https://evil.com', '//evil.com', 'http://evil.com', '....//evil.com',
              'xstand-a-line/../../evil', 'NOPE', 'ไม่มีจริง', '', 'a'.repeat(200)];
let all404 = true, noLocation = true;
EVIL.forEach(t => {
  const rr = hit(t);
  if (rr.statusCode !== 404) all404 = false;
  if (rr.headers.location) noLocation = false;
});
check('token แปลกๆ ทุกแบบตอบ 404 (ไม่ 500 ไม่ redirect)', all404);
check('ไม่มีกรณีไหนมี Location header เลย = พาออกนอกเว็บไม่ได้', noLocation);
check('ปลายทางทั้งหมดใน allowlist เป็น path ภายใน',
      act.ALLOWED_DEST.every(d => d.indexOf('/') === 0 && d.indexOf('//') !== 0));

/* ---- 8. ไม่พึ่ง DB / env ---- */
section('8. ทำงานได้แม้ฐานข้อมูลหลับ');
function codeOnly(file) {
  return require('fs').readFileSync(path.join(REPO, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const src = codeOnly('api/redirect.js');
const libSrc = codeOnly('api/_lib/activations.js');
check('ไม่ require supabase', !/require\(['"][^'"]*supabase/i.test(src));
check('ไม่อ่าน process.env', !/process\.env/.test(src));
check('ตารางปลายทางไม่ require อะไรเลย และไม่อ่าน env',
      !/require\(/.test(libSrc) && !/process\.env/.test(libSrc));
const before = process.env.SUPABASE_URL;
delete process.env.SUPABASE_URL;
check('ไม่มี SUPABASE_URL ก็ยังตอบได้', hit('xstand-a-line').statusCode === 404);
if (before !== undefined) process.env.SUPABASE_URL = before;

/* ---- 9. method และ cache ---- */
section('9. method และ cache');
check('POST -> 405', hit('xstand-a-line', 'POST').statusCode === 405);
check('HEAD ใช้ได้ (เครื่องสแกน QR บางตัวยิง HEAD ก่อน)',
      hit('xstand-a-line', 'HEAD').statusCode === 404);
check('no-store กัน CDN จำปลายทางเก่า', hit('xstand-a-line').headers['cache-control'] === 'no-store');
check('ไม่มีที่ไหนใช้ 301 (ย้ายงานแล้วจะแก้ไม่ได้)', !/301/.test(src));

section('10. runtime validates activation configuration');
for (const patch of [{dest:'https://evil.example'}, {extra:{from:'line'}},
  {extra:{activation_id:'FORGED'}}, {extra:{utm_source:'forged'}}, {active:'true'}]) {
  const map = {'booth-safe': [{...FIXTURE['booth-a'][1], ...patch}]};
  check('invalid configuration fails closed: '+JSON.stringify(patch), !act.resolve('booth-safe',map).found);
}
const duplicate = {'booth-safe': [FIXTURE['booth-a'][1], {...FIXTURE['booth-a'][1],activation_id:'A__B__r03'}]};
check('multiple active rounds fail closed', !act.resolve('booth-safe',duplicate).found);
const retired = {'booth-safe': [{...FIXTURE['booth-a'][1],active:false}]};
check('retired token retains valid history and returns not found',
  act.validate(retired).ok && !act.resolve('booth-safe',retired).found && act.history('booth-safe',retired).length===1);

console.log('\n========================================================');
console.log('ผ่าน ' + pass + ' / ไม่ผ่าน ' + fail);
console.log('========================================================');
process.exit(fail ? 1 : 0);
