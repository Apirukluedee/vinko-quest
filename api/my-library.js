'use strict';

const { json } = require('./_lib/util');
const sessions = require('./_lib/sessions');
const db       = require('./_lib/supabase');

const STORY_META = {
  'STORY-01': { num: 1, title: 'แรงโน้มถ่วงขอลาหยุด',     topic: 'ฟิสิกส์',      color: '#4e9af1' },
  'STORY-02': { num: 2, title: 'น้ำไม่เคยหายไปไหน',        topic: 'วัฏจักรน้ำ',   color: '#41b89c' },
  'STORY-03': { num: 3, title: 'ทำไมฟ้าถึงสีฟ้า',           topic: 'แสงและสี',     color: '#f5a623' },
  'STORY-04': { num: 4, title: 'เสียงเดินทางได้อย่างไร',    topic: 'เสียงและคลื่น', color: '#9b59b6' },
  'STORY-05': { num: 5, title: 'ดาวฤกษ์เกิดขึ้นได้อย่างไร', topic: 'ดาราศาสตร์',  color: '#e74c3c' }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false });

  // ตรวจ session จาก cookie
  const sessionToken = sessions.getSessionToken(req);
  const session      = await sessions.validateSession(sessionToken);
  if (!session) return json(res, 401, { ok: false, error: 'not_authenticated' });

  const email = session.email;

  // ดึง orders ของลูกค้า
  const ordersRes = await db.select('orders',
    'customer_email=eq.' + encodeURIComponent(email) +
    '&status=eq.paid' +
    '&select=id,order_ref,paid_at,reader_token,package_code' +
    '&order=paid_at.desc'
  );
  if (!ordersRes.ok) return json(res, 500, { ok: false, error: 'db_error' });

  const orders = Array.isArray(ordersRes.body) ? ordersRes.body : [];
  if (!orders.length) return json(res, 200, { ok: true, email, books: [] });

  // ดึง order_items สำหรับทุก order
  const orderIds = orders.map(o => o.id);
  const itemsRes = await db.select('order_items',
    'order_id=in.(' + orderIds.map(id => encodeURIComponent(id)).join(',') + ')' +
    '&select=order_id,product_code,delivery_type,scheduled_delivery_date,delivered_at'
  );
  const items = (itemsRes.ok && Array.isArray(itemsRes.body)) ? itemsRes.body : [];

  // จับคู่ reader_token กับแต่ละ story
  const books = [];
  for (const order of orders) {
    for (const item of items) {
      if (item.order_id !== order.id) continue;
      const meta = STORY_META[item.product_code];
      if (!meta) continue;

      books.push({
        product_code: item.product_code,
        num:    meta.num,
        title:  meta.title,
        topic:  meta.topic,
        color:  meta.color,
        reader_token:  order.reader_token || null,
        delivery_type: item.delivery_type,
        available:     item.delivery_type === 'instant' || !!item.delivered_at,
        delivery_date: item.scheduled_delivery_date || null
      });
    }
  }

  // เรียงตามเล่ม
  books.sort((a, b) => a.num - b.num);

  return json(res, 200, { ok: true, email, books });
};
