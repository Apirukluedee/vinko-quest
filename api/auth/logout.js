'use strict';

const sessions = require('../_lib/sessions');
const config   = require('../_lib/config');

module.exports = function handler(req, res) {
  const base = config.appBaseUrl() || 'https://vinko.quest';
  res.setHeader('Set-Cookie', sessions.cookieHeader(null, true));
  return res.redirect(302, base + '/login?logged_out=1');
};
