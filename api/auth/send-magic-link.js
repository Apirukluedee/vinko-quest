'use strict';

const { json }           = require('../_lib/util');
const sessions           = require('../_lib/sessions');
const config             = require('../_lib/config');

const FROM        = 'VINKO <hello@mail.vinko.quest>';
const BRAND_NAVY  = '#071B5D';
const BRAND_OG    = '#F59A23';

function baseUrl() { return config.appBaseUrl() || 'https://vinko.quest'; }

function buildEmail(magicUrl) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F4F6FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FB;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
<tr><td style="background:${BRAND_NAVY};padding:20px 26px;">
  <div style="color:#fff;font-size:17px;font-weight:bold;">VINKO · WOW LAB</div>
  <div style="color:#B9C4E8;font-size:12px;margin-top:2px;">Little Kitchen. Big Discoveries.</div>
</td></tr>
<tr><td style="padding:26px;color:#2A3040;font-size:15px;line-height:1.75;">
  <p style="margin:0 0 16px">สวัสดีครับ 👋</p>
  <p style="margin:0 0 24px">กดปุ่มด้านล่างเพื่อเข้าสู่ระบบและดูหนังสือที่ซื้อไว้ได้เลย ลิงก์นี้ใช้ได้ <strong>15 นาที</strong> เท่านั้น</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td align="center" bgcolor="${BRAND_OG}" style="border-radius:999px;">
    <a href="${magicUrl}" style="display:inline-block;padding:15px 36px;color:#fff;font-size:17px;font-weight:bold;text-decoration:none;border-radius:999px;">
      📚 เข้าดูหนังสือของฉัน
    </a>
  </td></tr></table>
  <p style="margin:24px 0 0;font-size:13px;color:#6B7285;">ถ้ากดปุ่มไม่ได้ ให้คัดลอก URL นี้ไปวางในเบราว์เซอร์:<br/>
  <a href="${magicUrl}" style="color:${BRAND_NAVY};word-break:break-all;">${magicUrl}</a></p>
  <p style="margin:16px 0 0;font-size:13px;color:#6B7285;">ถ้าคุณไม่ได้ขอ link นี้ ไม่ต้องทำอะไร ระบบจะยกเลิกอัตโนมัติ</p>
</td></tr>
<tr><td style="background:#F7F4EF;padding:18px 26px;color:#6B7285;font-size:12px;line-height:1.7;">
  VINKO WOW LAB<br/>
  LINE: <a href="https://lin.ee/8F08BYJ" style="color:${BRAND_NAVY};">lin.ee/8F08BYJ</a>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { ok: false, error: 'email_invalid' });
  }

  const resendKey = config.resendApiKey();
  if (!resendKey) return json(res, 503, { ok: false, error: 'email_not_configured' });

  let magic_token;
  try {
    ({ magic_token } = await sessions.createMagicSession(email));
  } catch (e) {
    console.error('[auth] createMagicSession failed:', e.message);
    return json(res, 500, { ok: false, error: 'internal' });
  }

  const magicUrl = baseUrl() + '/api/auth/verify-magic?token=' + encodeURIComponent(magic_token) + '&openExternalBrowser=1';
  const html     = buildEmail(magicUrl);

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: '📚 เข้าดูหนังสือ VINKO ของคุณ',
      html,
      text: 'เข้าดูหนังสือที่ซื้อไว้ได้ที่ลิงก์นี้ (ใช้ได้ 15 นาที):\n' + magicUrl
    })
  });

  if (!sendRes.ok) {
    const err = await sendRes.text().catch(() => '');
    console.error('[auth] resend failed', sendRes.status, err.slice(0, 200));
    return json(res, 500, { ok: false, error: 'send_failed' });
  }

  return json(res, 200, { ok: true });
};
