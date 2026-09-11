'use strict';

const crypto = require('crypto');
const config = require('../_lib/config');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const channelId = config.lineLoginChannelId();
  const base      = config.appBaseUrl() || 'https://vinko.quest';

  if (!channelId) {
    return res.redirect(302, base + '/login?error=line_not_configured');
  }

  const state        = crypto.randomBytes(16).toString('hex');
  const callbackUrl  = base + '/api/auth/line-callback';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     channelId,
    redirect_uri:  callbackUrl,
    state:         state,
    scope:         'profile openid email',
    bot_prompt:    'normal'
  });

  // เก็บ state ใน cookie สั้น (10 นาที) เพื่อตรวจ CSRF ใน callback
  res.setHeader('Set-Cookie',
    'vnk_line_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
  );

  return res.redirect(302, 'https://access.line.me/oauth2/v2.1/authorize?' + params.toString());
};
