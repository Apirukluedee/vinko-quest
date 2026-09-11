'use strict';

const sessions = require('../_lib/sessions');
const config   = require('../_lib/config');

function getCookieValue(req, name) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const base       = config.appBaseUrl() || 'https://vinko.quest';
  const channelId  = config.lineLoginChannelId();
  const secret     = config.lineLoginChannelSecret();

  if (!channelId || !secret) {
    return res.redirect(302, base + '/login?error=line_not_configured');
  }

  const q         = req.query || Object.fromEntries(new URL(req.url, 'https://x').searchParams);
  const code      = q.code  || '';
  const stateBack = q.state || '';
  const stateSaved = getCookieValue(req, 'vnk_line_state');

  // ล้าง state cookie ทันที
  res.setHeader('Set-Cookie',
    'vnk_line_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );

  if (!code || !stateBack || stateBack !== stateSaved) {
    return res.redirect(302, base + '/login?error=line_state_mismatch');
  }

  /* ── 1. แลก code เป็น access token ── */
  const callbackUrl = base + '/api/auth/line-callback';
  let lineToken;
  try {
    const r = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  callbackUrl,
        client_id:     channelId,
        client_secret: secret
      }).toString()
    });
    if (!r.ok) throw new Error('token_exchange_' + r.status);
    lineToken = await r.json();
  } catch (e) {
    console.error('[line-cb] token exchange failed:', e.message);
    return res.redirect(302, base + '/login?error=line_token_failed');
  }

  /* ── 2. ดึงข้อมูล profile + email ── */
  let lineUserId, email;
  try {
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { 'Authorization': 'Bearer ' + lineToken.access_token }
    });
    if (!profileRes.ok) throw new Error('profile_' + profileRes.status);
    const profile = await profileRes.json();
    lineUserId = profile.userId;

    // ดึง email จาก id_token (LINE ให้มาถ้า scope รวม email)
    if (lineToken.id_token) {
      const parts   = lineToken.id_token.split('.');
      const payload = parts[1] ? JSON.parse(Buffer.from(parts[1], 'base64').toString()) : {};
      email = payload.email || '';
    }
  } catch (e) {
    console.error('[line-cb] profile failed:', e.message);
    return res.redirect(302, base + '/login?error=line_profile_failed');
  }

  if (!email) {
    // LINE ไม่ให้ email → ให้กรอก email เอง พร้อม line_user_id แบบ temp
    return res.redirect(302,
      base + '/login?line_uid=' + encodeURIComponent(lineUserId) + '&need_email=1'
    );
  }

  /* ── 3. สร้าง session ── */
  let session_token;
  try {
    ({ session_token } = await sessions.createLineSession(email.toLowerCase(), lineUserId));
  } catch (e) {
    console.error('[line-cb] createLineSession failed:', e.message);
    return res.redirect(302, base + '/login?error=internal');
  }

  res.setHeader('Set-Cookie', sessions.cookieHeader(session_token));
  return res.redirect(302, base + '/library');
};
