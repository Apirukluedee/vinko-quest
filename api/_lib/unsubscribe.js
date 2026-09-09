/* ============================================================
   ลิงก์ยกเลิกรับอีเมลการตลาด (PDPA) — ต้องมีไว้ก่อนเริ่มส่งอีเมลการตลาดจริง

   อยู่ใน _lib แทนที่จะเป็นไฟล์แยกใน api/ เพราะทุกไฟล์ใต้ api/ นับเป็น
   Serverless Function 1 ตัวของ Vercel — แพ็กเกจ Hobby จำกัดไว้ 12 ตัว
   จึง route มาจาก /api/health ผ่าน rewrite ใน vercel.json แทน (ดู health.js)

   ใช้ unsubscribe_token คนละคีย์กับ download_token โดยเจตนา (ดู migration 006)
   กดได้เสมอไม่ว่าออเดอร์จะสถานะไหน ไม่มีเงื่อนไขที่ทำให้ยกเลิกไม่สำเร็จ
   ทำ 2 ครั้งก็ไม่พัง (idempotent) — ครั้งที่สองแค่โชว์หน้าเดิมซ้ำ ไม่เขียนทับเวลาเดิม
   ============================================================ */

'use strict';

const tokens = require('./tokens');
const db = require('./supabase');
const { requireEnv } = require('./util');

function page(title, heading, body) {
  return '<!doctype html><html lang="th"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + title + ' | VINKO WOW LAB</title>' +
    '<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#FFF9F0;' +
    'color:#071B5D;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}' +
    'h1{font-size:22px;margin:0 0 10px}p{margin:0 0 18px;line-height:1.7;color:#5a6280;max-width:420px}' +
    'a{display:inline-block;background:#F5A623;color:#071B5D;text-decoration:none;font-weight:800;' +
    'padding:13px 26px;border-radius:999px}</style>' +
    '<h1>' + heading + '</h1>' + body + '<a href="/">ไปหน้าแรก VINKO</a>';
}

const INVALID_HTML = page('ลิงก์ไม่ถูกต้อง', 'ลิงก์ไม่ถูกต้อง',
  '<p>ลิงก์ยกเลิกนี้อาจพิมพ์ผิดหรือไม่สมบูรณ์ ถ้าต้องการยกเลิกรับอีเมล ' +
  'ติดต่อเราได้ที่ ' + 'admin@vinko.quest' + '</p>');

function successHtml(alreadyDone) {
  return page('ยกเลิกรับอีเมลการตลาดแล้ว', alreadyDone ? 'ยกเลิกไว้แล้ว' : 'ยกเลิกรับอีเมลการตลาดเรียบร้อย',
    '<p>' + (alreadyDone
      ? 'อีเมลนี้ยกเลิกรับข่าวสารการตลาดไปแล้วก่อนหน้านี้ ไม่ต้องทำอะไรเพิ่ม'
      : 'จะไม่มีอีเมลโปรโมชันหรือข่าวสารส่งไปหาอีเมลนี้อีก') +
    '<br>ส่วนอีเมลแจ้งเตือนคำสั่งซื้อ/ลิงก์ดาวน์โหลดของที่ซื้อไปแล้ว ยังส่งตามปกติ</p>');
}

/** req.url ต้องยังมี query token=... ติดมาด้วย (rewrite ใน vercel.json ส่งผ่านให้อัตโนมัติ) */
async function handleUnsubscribe(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    console.error('[vinko][unsubscribe] ระบบยังไม่พร้อม', e.message);
    res.statusCode = 500;
    res.end(page('ระบบขัดข้อง', 'ระบบขัดข้องชั่วคราว', '<p>ลองใหม่อีกครั้งภายหลัง หรือติดต่อ admin@vinko.quest</p>'));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const token = (url.searchParams.get('token') || '').trim();

  const order = await tokens.resolveUnsubscribe(token);
  if (!order) {
    console.warn('[vinko][unsubscribe] token ไม่พบ:', JSON.stringify(token).slice(0, 60));
    res.statusCode = 404;
    res.end(INVALID_HTML);
    return;
  }

  if (order.marketing_optout_at) {
    // ยกเลิกไปแล้วก่อนหน้านี้ — ไม่เขียนทับเวลาเดิม (ต้องพิสูจน์ได้ว่ายกเลิก "เมื่อไหร่" ครั้งแรก)
    res.statusCode = 200;
    res.end(successHtml(true));
    return;
  }

  const r = await db.update('orders', 'id=eq.' + order.id, {
    marketing_optout_at: new Date().toISOString()
  });
  if (!r.ok) {
    console.error('[vinko][unsubscribe] เขียน marketing_optout_at ไม่สำเร็จ', order.order_ref, JSON.stringify(r.body));
    res.statusCode = 500;
    res.end(page('ระบบขัดข้อง', 'ระบบขัดข้องชั่วคราว', '<p>ลองใหม่อีกครั้งภายหลัง หรือติดต่อ admin@vinko.quest</p>'));
    return;
  }

  console.log('[vinko][unsubscribe]', order.order_ref, '-> ยกเลิกรับอีเมลการตลาดแล้ว');
  res.statusCode = 200;
  res.end(successHtml(false));
}

module.exports = { handleUnsubscribe };
