/* ============================================================
   GET /api/cron/deliver-preorders   (Vercel Cron รันวันละครั้ง)

   หา order_items ที่เป็น pre-order ถึงกำหนดแล้วและยังไม่ได้ส่ง
   ต่ออายุ token แล้วส่งอีเมลแจ้ง

   ถ้าไฟล์ยังไม่มีใน Storage ห้ามส่งอีเมล
   ระบบต้องไม่บอกลูกค้าว่าของพร้อมแล้วทั้งที่ยังไม่มีไฟล์
   ============================================================ */
'use strict';

const db      = require('./../_lib/supabase');
const tokens  = require('./../_lib/tokens');
const storage = require('./../_lib/storage');
const email   = require('./../_lib/email');
const { json, safeEqual } = require('./../_lib/util');
const config  = require('./../_lib/config');

module.exports = async function handler(req, res) {
  // Vercel Cron ส่ง Authorization: Bearer <CRON_SECRET> มาให้
  const secret = config.cronSecret();
  const auth = String(req.headers.authorization || '');
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!secret || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false });
  }

  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);   // วันที่ตามเวลาไทย

  const r = await db.select('order_items',
    'delivery_type=eq.preorder&delivered_at=is.null' +
    '&scheduled_delivery_date=lte.' + today +
    '&select=id,order_id,product_code,title,scheduled_delivery_date&limit=200');
  const due = Array.isArray(r.body) ? r.body : [];

  const out = { checked: due.length, sent: 0, skipped_no_file: 0, skipped_unpaid: 0, failed: 0, details: [] };

  for (const item of due) {
    try {
      // ไฟล์ต้องมีจริงก่อนถึงจะบอกลูกค้าว่าพร้อมแล้ว
      if (!(await storage.exists(item.product_code))) {
        out.skipped_no_file++;
        console.warn('[vinko][cron] ยังไม่มีไฟล์ใน storage:', item.product_code, '- ข้ามไปก่อน');
        continue;
      }

      const o = await db.select('orders',
        'id=eq.' + item.order_id +
        '&select=id,order_ref,status,customer_email,download_token,token_expires_at&limit=1');
      const order = Array.isArray(o.body) && o.body[0];
      if (!order || order.status !== 'paid') { out.skipped_unpaid++; continue; }

      const token = await tokens.renew(order);
      const fresh = await db.select('orders', 'id=eq.' + order.id + '&select=token_expires_at&limit=1');
      const expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                        tokens.expiryFromNow();

      const all = await tokens.itemsFor(order.id);
      const remaining = all.filter(function (i) {
        return i.delivery_type === 'preorder' && !i.delivered_at && i.id !== item.id;
      });

      const payload = email.storyEmail({
        orderRef: order.order_ref, itemTitle: item.title,
        token: token, expiresAt: expiresAt, remaining: remaining
      });
      const sent = await email.send('story_delivery', order.customer_email, payload,
                                    { orderId: order.id, orderItemId: item.id });

      if (sent.ok) {
        // ตั้ง delivered_at เฉพาะตอนที่ยังว่างอยู่ กันส่งซ้ำถ้า cron ทับกัน
        await db.update('order_items', 'id=eq.' + item.id + '&delivered_at=is.null',
                        { delivered_at: new Date().toISOString() });
        out.sent++;
        out.details.push(order.order_ref + ' · ' + item.title);
      } else {
        out.failed++;
        console.error('[vinko][cron] ส่งอีเมลไม่สำเร็จ', order.order_ref, sent.error);
      }
    } catch (e) {
      out.failed++;
      console.error('[vinko][cron] item', item.id, e.message);
    }
  }

  return json(res, 200, Object.assign({ ok: true, date: today }, out));
};
