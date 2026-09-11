'use strict';

const db      = require('./supabase');
const tokens  = require('./tokens');
const email   = require('./email');
const catalog = require('./catalog');
const config  = require('./config');

async function deliver(orderRef, opts) {
  const force = opts && opts.force;

  const r = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) +
    '&select=id,order_ref,status,package_code,customer_name,customer_email,' +
    'download_token,token_expires_at,reader_token&limit=1');
  const order = Array.isArray(r.body) && r.body[0];
  if (!order) return { ok: false, error: 'ไม่พบคำสั่งซื้อ' };
  if (order.status !== 'paid') return { ok: false, error: 'คำสั่งซื้อยังไม่อยู่ในสถานะ paid' };

  const stillValid = order.download_token && order.token_expires_at &&
                     new Date(order.token_expires_at).getTime() > Date.now();
  if (stillValid && !force) {
    const sent = await db.count('email_events',
      'order_id=eq.' + order.id + '&kind=eq.purchase&status=eq.sent');
    if (sent > 0) return { ok: true, skipped: 'ส่งอีเมลไปแล้ว' };
  }

  const token = stillValid && !force
    ? order.download_token
    : await tokens.issue(order.id);

  const fresh = await db.select('orders',
    'id=eq.' + order.id + '&select=token_expires_at&limit=1');
  const expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                    tokens.expiryFromNow();

  const items = await tokens.itemsFor(order.id);
  const pkg   = catalog.getPackage(order.package_code);
  const readerToken = await tokens.getOrCreateReaderToken(order).catch(function() { return null; });

  const payload = email.purchaseEmail({
    orderRef:     order.order_ref,
    packageCode:  order.package_code,
    packageTitle: (pkg && pkg.title) || order.package_code,
    token:        token,
    expiresAt:    expiresAt,
    items:        items,
    readerToken:  readerToken
  });

  const out = await email.send('purchase', order.customer_email, payload, { orderId: order.id });
  return { ok: true, emailed: out.ok, message_id: out.id || null, error: out.error || null };
}

module.exports = { deliver };
