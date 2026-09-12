/* ============================================================
   GET|POST /api/auth   ?action=<send-magic-link|verify-magic|line-start|line-callback|logout>
   GET       /api/auth   ?action=my-library

   รวม 6 endpoints ไว้ที่ไฟล์เดียว ลด serverless function count
   (Vercel Hobby จำกัด 12 ตัว)  vercel.json มี rewrite ส่งทุก
   /api/auth/:action → /api/auth?action=:action  และ
   /api/my-library → /api/auth?action=my-library
   ============================================================ */
'use strict';

const crypto   = require('crypto');
const sessions = require('./_lib/sessions');
const config   = require('./_lib/config');
const db       = require('./_lib/supabase');
const { json } = require('./_lib/util');
const signedToken = require('./_lib/signed_token');

function base() { return config.appBaseUrl() || 'https://vinko.quest'; }

/* ── send-magic-link ─────────────────────────────────────── */

const FROM   = 'VINKO <hello@mail.vinko.quest>';
const NAVY   = '#071B5D';
const ORANGE = '#F59A23';

function buildMagicEmail(magicUrl) {
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"/>' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"/></head>' +
  '<body style="margin:0;padding:0;background:#F4F6FB;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FB;padding:24px 12px;">' +
  '<tr><td align="center">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"' +
  ' style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;font-family:\'Segoe UI\',Tahoma,Arial,sans-serif;">' +
  '<tr><td style="background:' + NAVY + ';padding:20px 26px;">' +
  '<div style="color:#fff;font-size:17px;font-weight:bold;">VINKO · WOW LAB</div>' +
  '<div style="color:#B9C4E8;font-size:12px;margin-top:2px;">Little Kitchen. Big Discoveries.</div>' +
  '</td></tr>' +
  '<tr><td style="padding:26px;color:#2A3040;font-size:15px;line-height:1.75;">' +
  '<p style="margin:0 0 16px">สวัสดีครับ 👋</p>' +
  '<p style="margin:0 0 24px">กดปุ่มด้านล่างเพื่อเข้าสู่ระบบและดูหนังสือที่ซื้อไว้ได้เลย ลิงก์นี้ใช้ได้ <strong>15 นาที</strong> เท่านั้น</p>' +
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">' +
  '<tr><td align="center" bgcolor="' + ORANGE + '" style="border-radius:999px;">' +
  '<a href="' + magicUrl + '" style="display:inline-block;padding:15px 36px;color:#fff;font-size:17px;font-weight:bold;text-decoration:none;border-radius:999px;">' +
  '📚 เข้าดูหนังสือของฉัน</a>' +
  '</td></tr></table>' +
  '<p style="margin:24px 0 0;font-size:13px;color:#6B7285;">ถ้ากดปุ่มไม่ได้ ให้คัดลอก URL นี้ไปวางในเบราว์เซอร์:<br/>' +
  '<a href="' + magicUrl + '" style="color:' + NAVY + ';word-break:break-all;">' + magicUrl + '</a></p>' +
  '<p style="margin:16px 0 0;font-size:13px;color:#6B7285;">ถ้าคุณไม่ได้ขอ link นี้ ไม่ต้องทำอะไร ระบบจะยกเลิกอัตโนมัติ</p>' +
  '</td></tr>' +
  '<tr><td style="background:#F7F4EF;padding:18px 26px;color:#6B7285;font-size:12px;line-height:1.7;">' +
  'VINKO WOW LAB<br/>' +
  'LINE: <a href="https://lin.ee/8F08BYJ" style="color:' + NAVY + ';">lin.ee/8F08BYJ</a>' +
  '</td></tr></table></td></tr></table></body></html>';
}

async function handleSendMagicLink(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { ok: false, error: 'email_invalid' });
  }

  // line_uid มาจากหน้า login ตอน LINE ไม่ได้แชร์อีเมลมาให้ (ดู need_email
  // ใน handleLineCallback) — เก็บไว้คู่กับอีเมลนี้เพื่อผูกบัญชีไว้ถาวร
  const rawLineUid = (body.line_uid || '').trim();
  const lineUid = /^U[0-9a-f]{32}$/.test(rawLineUid) ? rawLineUid : null;

  const resendKey = config.resendApiKey();
  if (!resendKey) return json(res, 503, { ok: false, error: 'email_not_configured' });

  let magic_token;
  try {
    ({ magic_token } = await sessions.createMagicSession(email, lineUid));
  } catch (e) {
    console.error('[auth] createMagicSession failed:', e.message);
    return json(res, 500, { ok: false, error: 'internal' });
  }

  const magicUrl = base() + '/api/auth/verify-magic?token=' + encodeURIComponent(magic_token) + '&openExternalBrowser=1';
  const html     = buildMagicEmail(magicUrl);

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: email,
      subject: '📚 เข้าดูหนังสือ VINKO ของคุณ',
      html,
      text: 'เข้าดูหนังสือที่ซื้อไว้ได้ที่ลิงก์นี้ (ใช้ได้ 15 นาที):\n' + magicUrl
    })
  });

  if (!sendRes.ok) {
    const err = await sendRes.text().catch(function() { return ''; });
    console.error('[auth] resend failed', sendRes.status, err.slice(0, 200));
    return json(res, 500, { ok: false, error: 'send_failed' });
  }

  return json(res, 200, { ok: true });
}

/* ── verify-magic ────────────────────────────────────────── */

async function handleVerifyMagic(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const token = (req.query && req.query.token) ||
    new URL(req.url, 'https://x').searchParams.get('token') || '';

  if (!token) return res.redirect(302, base() + '/login?error=invalid_link');

  let result;
  try {
    result = await sessions.activateMagicSession(token);
  } catch (e) {
    console.error('[auth] activateMagicSession error:', e.message);
    return res.redirect(302, base() + '/login?error=internal');
  }

  if (!result) return res.redirect(302, base() + '/login?error=expired_link');

  res.setHeader('Set-Cookie', sessions.cookieHeader(result.session_token));
  return res.redirect(302, base() + '/library');
}

/* ── line-start ──────────────────────────────────────────────────────
   state ของ OAuth เซ็นด้วย HMAC (signed_token.js) ฝัง payload+ลายเซ็น
   ไว้ในตัวเอง ไม่ต้องพึ่ง cookie หรือ sessionStorage มาเทียบค่าอีกต่อไป
   — แก้ปัญหาที่เจอจริง: ตอนลูกค้ากด "เข้าสู่ระบบด้วยแอป LINE" (ทางหลักที่
   คนส่วนใหญ่ใช้เพราะจำอีเมล/รหัสผ่าน LINE ไม่ได้) แอป LINE จะเปิด
   redirect กลับมาเองในเบราว์เซอร์ในแอปของมัน คนละ context กับที่เริ่ม
   flow ไว้เสมอ ทำให้ sessionStorage/cookie ตามไปไม่ได้จริง ไม่ว่าจะ
   เก็บด้วยวิธีไหนก็ตาม — signature ตรวจได้จาก secret ฝั่ง server ล้วนๆ
   จึงไม่มีปัญหานี้อีกเลย

   query param `connect_token` (มาจากลิงก์ "เชื่อมบัญชี LINE" ในอีเมล
   ยืนยันคำสั่งซื้อ — ดู email.js:connectLineUrl) ถ้ามีและยังไม่หมดอายุ
   จะฝังอีเมลนั้นไว้ใน state ไปด้วย ทำให้ callback รู้ทันทีว่าต้องผูก LINE
   เข้ากับอีเมลไหน ไม่ต้องถามลูกค้าเลย (ข้ามขั้น need_email ไปเลย) */

function handleLineStart(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const channelId = config.lineLoginChannelId();
  const secret    = config.lineLoginChannelSecret();
  if (!channelId || !secret) return json(res, 200, { ok: false, error: 'line_not_configured' });

  const statePayload = { p: 'oauth', n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 10 * 60 * 1000 };

  const connectTokenRaw = ((req.query && req.query.connect_token) || '').trim();
  if (connectTokenRaw) {
    const connectPayload = signedToken.verify(connectTokenRaw, secret);
    if (connectPayload && connectPayload.p === 'connect' && connectPayload.email) {
      statePayload.email = connectPayload.email;
    }
  }

  const state       = signedToken.sign(statePayload, secret);
  const redirectUri = base() + '/login';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     channelId,
    redirect_uri:  redirectUri,
    state:         state,
    scope:         'profile openid email',
    bot_prompt:    'normal'
  });

  return json(res, 200, {
    ok: true,
    authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize?' + params.toString()
  });
}

/* ── line-callback ──────────────────────────────────────────────────
   POST จาก JS ของ login.html เท่านั้น (ไม่ใช่ LINE redirect ตรงมาแล้ว —
   redirect_uri ที่จดใน LINE Developers console คือ /login ธรรมดา)
   client แค่ forward code+state ที่ได้กลับมาจาก LINE ตรงๆ ไม่ต้องเช็ค
   อะไรเองแล้ว — ที่นี่ verify ลายเซ็นของ state เองทั้งหมด (ดูโน้ตที่
   handleLineStart ว่าทำไมถึงเลิกพึ่ง cookie/sessionStorage) */

async function handleLineCallback(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const channelId = config.lineLoginChannelId();
  const secret    = config.lineLoginChannelSecret();

  if (!channelId || !secret) {
    return json(res, 200, { ok: false, error: 'line_not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const code        = (body.code || '').trim();
  const redirectUri = (body.redirect_uri || '').trim();
  const stateRaw     = (body.state || '').trim();

  if (!code || !redirectUri) {
    return json(res, 200, { ok: false, error: 'invalid_link' });
  }

  const statePayload = signedToken.verify(stateRaw, secret);
  if (!statePayload || statePayload.p !== 'oauth') {
    return json(res, 200, { ok: false, error: 'line_state_mismatch' });
  }
  const connectEmail = statePayload.email || null;

  let lineToken;
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     channelId,
        client_secret: secret
      }).toString()
    });
    if (!r.ok) throw new Error('token_exchange_' + r.status);
    lineToken = await r.json();
  } catch (e) {
    console.error('[line-cb] token exchange failed:', e.message);
    return json(res, 200, { ok: false, error: 'line_token_failed' });
  }

  let lineUserId, email;
  try {
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { 'Authorization': 'Bearer ' + lineToken.access_token }
    });
    if (!profileRes.ok) throw new Error('profile_' + profileRes.status);
    const profile = await profileRes.json();
    lineUserId = profile.userId;

    if (lineToken.id_token) {
      const parts   = lineToken.id_token.split('.');
      const payload = parts[1] ? JSON.parse(Buffer.from(parts[1], 'base64').toString()) : {};
      email = payload.email || '';
    }
  } catch (e) {
    console.error('[line-cb] profile failed:', e.message);
    return json(res, 200, { ok: false, error: 'line_profile_failed' });
  }

  // ลำดับความสำคัญของอีเมล: connect_token จากลิงก์ในอีเมลคำสั่งซื้อ (ความ
  // ตั้งใจชัดเจนที่สุด — ลูกค้ากดลิงก์นี้เพื่อผูกบัญชีกับอีเมลนี้โดยเฉพาะ)
  // > อีเมลที่ LINE แชร์มาเอง > อีเมลที่เคยผูกไว้จาก need_email รอบก่อน
  if (connectEmail) email = connectEmail;

  if (!email) {
    // LINE ไม่ได้แชร์อีเมลมารอบนี้ — เช็คก่อนว่าเคยผูกอีเมลไว้กับ LINE user
    // นี้แล้วหรือยัง (จากตอนกรอกอีเมล fallback ครั้งก่อน) ถ้าเจอ ใช้อีเมล
    // เดิมได้เลย ไม่ต้องให้กรอกซ้ำทุกครั้งที่ login ด้วย LINE
    let linkedEmail = null;
    try {
      linkedEmail = await sessions.findEmailByLineUserId(lineUserId);
    } catch (e) {
      console.error('[line-cb] findEmailByLineUserId failed:', e.message);
    }
    if (!linkedEmail) {
      return json(res, 200, { ok: false, error: 'need_email', line_uid: lineUserId });
    }
    email = linkedEmail;
  }

  let session_token;
  try {
    ({ session_token } = await sessions.createLineSession(email.toLowerCase(), lineUserId));
  } catch (e) {
    console.error('[line-cb] createLineSession failed:', e.message);
    return json(res, 200, { ok: false, error: 'internal' });
  }

  res.setHeader('Set-Cookie', sessions.cookieHeader(session_token));
  return json(res, 200, { ok: true });
}

/* ── logout ──────────────────────────────────────────────── */

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', sessions.cookieHeader(null, true));
  return res.redirect(302, base() + '/login?logged_out=1');
}

/* ── my-library ──────────────────────────────────────────── */

const STORY_META = {
  'STORY-01': { num: 1, title: 'วันที่แรงโน้มถ่วงลางาน',   topic: 'แรงโน้มถ่วง',      color: '#4e9af1' },
  'STORY-02': { num: 2, title: 'คดีสีสันที่หายไป',          topic: 'แสงและสี',         color: '#41b89c' },
  'STORY-03': { num: 3, title: 'ใครขโมยเสียงของนิวไป?',    topic: 'เสียงและคลื่น',    color: '#f5a623' },
  'STORY-04': { num: 4, title: 'แม่เหล็กป่วนปาร์ตี้!',       topic: 'แม่เหล็ก',         color: '#9b59b6' },
  'STORY-05': { num: 5, title: 'อะไรอยู่ในแก้ว?',           topic: 'อากาศและความดัน', color: '#e74c3c' }
};

// VINKO WOW LAB ไม่มีเสียงอ่าน/reader เหมือน STORY — มีแค่ไฟล์ PDF ให้โหลด
// จึงแยกชุดข้อมูลนี้ออกจาก STORY_META (การ์ดจะไม่มีปุ่ม "ฟังเสียงอ่าน")
const LAB_META = {
  'LAB-MAIN':     { icon: '🧪', title: 'VINKO WOW LAB — 10 ภารกิจในครัว',                          topic: '10 ภารกิจสุดว้าว',    color: '#F59A23' },
  'LAB-WORKBOOK': { icon: '📝', title: 'ใบบันทึกนักวิทย์น้อย — ใบงาน 10 ภารกิจ',                    topic: 'ใบงานประกอบเล่มหลัก', color: '#173A8A' }
};

function thaiDate(iso) {
  if (!iso) return '';
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00+07:00');
  if (isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

async function handleMyLibrary(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false });

  const sessionToken = sessions.getSessionToken(req);
  const user = sessionToken ? await sessions.validateSession(sessionToken) : null;
  if (!user) return json(res, 401, { ok: false, error: 'unauthorized' });

  const ordersRes = await db.select('orders',
    'customer_email=eq.' + encodeURIComponent(user.email) +
    '&status=eq.paid&select=id,order_ref,package_code,reader_token'
  );
  const orders = Array.isArray(ordersRes.body) ? ordersRes.body : [];
  if (!orders.length) return json(res, 200, { ok: true, email: user.email, books: [] });

  const orderIds = orders.map(function(o) { return o.id; });
  const itemsRes = await db.select('order_items',
    'order_id=in.(' + orderIds.join(',') + ')' +
    '&select=id,order_id,product_code,title,delivery_type,scheduled_delivery_date,refunded_at'
  );
  const items = Array.isArray(itemsRes.body) ? itemsRes.body : [];

  // reader_token ต้องผูกกับออเดอร์ของ item นั้นๆ เอง ไม่ใช่หยิบจากออเดอร์
  // ไหนก็ได้ที่มี reader_token — ลูกค้าที่มีหลายออเดอร์ (เช่นซื้อซ้ำ หรือ
  // มีออเดอร์ทดสอบปนอยู่) เคยโดนจับคู่ item ของออเดอร์หนึ่งกับ token ของ
  // อีกออเดอร์หนึ่งโดยบังเอิญ ทำให้ปุ่มดาวน์โหลด PDF ใช้ไม่ได้
  const tokenByOrderId = {};
  orders.forEach(function(o) { tokenByOrderId[o.id] = o.reader_token || null; });

  const books = [];
  for (const [code, meta] of Object.entries(STORY_META)) {
    const item = items.find(function(i) { return i.product_code === code && !i.refunded_at; });
    if (!item) continue;
    books.push({
      kind:          'story',
      num:           meta.num,
      title:         meta.title,
      topic:         meta.topic,
      color:         meta.color,
      available:     item.delivery_type === 'instant',
      delivery_date: item.delivery_type === 'preorder'
        ? thaiDate(item.scheduled_delivery_date)
        : null,
      reader_token:  item.delivery_type === 'instant' ? tokenByOrderId[item.order_id] : null,
      item_id:       item.delivery_type === 'instant' ? item.id : null
    });
  }
  books.sort(function(a, b) { return a.num - b.num; });

  const labBooks = [];
  for (const [code, meta] of Object.entries(LAB_META)) {
    const item = items.find(function(i) { return i.product_code === code && !i.refunded_at; });
    if (!item) continue;
    labBooks.push({
      kind:          'lab',
      icon:          meta.icon,
      title:         meta.title,
      topic:         meta.topic,
      color:         meta.color,
      available:     item.delivery_type === 'instant',
      delivery_date: item.delivery_type === 'preorder'
        ? thaiDate(item.scheduled_delivery_date)
        : null,
      reader_token:  item.delivery_type === 'instant' ? tokenByOrderId[item.order_id] : null,
      item_id:       item.delivery_type === 'instant' ? item.id : null
    });
  }

  return json(res, 200, { ok: true, email: user.email, books: labBooks.concat(books) });
}

/* ── dispatcher ──────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  switch (action) {
    case 'send-magic-link': return handleSendMagicLink(req, res);
    case 'verify-magic':    return handleVerifyMagic(req, res);
    case 'line-start':      return handleLineStart(req, res);
    case 'line-callback':   return handleLineCallback(req, res);
    case 'logout':          return handleLogout(req, res);
    case 'my-library':      return handleMyLibrary(req, res);
    default:
      return json(res, 404, { ok: false, error: 'not_found' });
  }
};
