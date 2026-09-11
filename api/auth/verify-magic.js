'use strict';

const sessions = require('../_lib/sessions');
const config   = require('../_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  const token = (req.query && req.query.token) || new URL(req.url, 'https://x').searchParams.get('token') || '';

  const base = config.appBaseUrl() || 'https://vinko.quest';

  if (!token) {
    return res.redirect(302, base + '/login?error=invalid_link');
  }

  let result;
  try {
    result = await sessions.activateMagicSession(token);
  } catch (e) {
    console.error('[auth] activateMagicSession error:', e.message);
    return res.redirect(302, base + '/login?error=internal');
  }

  if (!result) {
    return res.redirect(302, base + '/login?error=expired_link');
  }

  res.setHeader('Set-Cookie', sessions.cookieHeader(result.session_token));
  return res.redirect(302, base + '/library');
};
