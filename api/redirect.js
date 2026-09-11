/* ============================================================
   GET /r/:token   (rewrite ไปที่ /api/redirect?token=:token)

   ลิงก์กลางที่ฝังใน QR บน X-stand ย้ายงานได้โดยไม่ต้องพิมพ์ QR ใหม่

   กฎ 4 ข้อของไฟล์นี้:

   1. ห้ามแตะฐานข้อมูล ห้ามอ่าน env ใดๆ
      คนที่สแกน QR ยืนอยู่หน้างาน รอไม่ได้และไม่ควรเจอ error
      ปลายทางอยู่ในโค้ด (_lib/activations.js) จึงทำงานได้แม้ฐานข้อมูลหลับ

   2. ปลายทางมาจากตารางเท่านั้น ห้ามรับ URL จาก query string เด็ดขาด
      อ่านเฉพาะ token ตัวเดียว พารามิเตอร์อื่นที่แนบมาถูกทิ้งทั้งหมด

   3. token ที่ไม่รู้จักหรือยังไม่ยืนยัน -> 404 พร้อมลิงก์กลับหน้าแรก
      ห้าม redirect ไปหน้าอื่นเป็นการปลอบใจ เพราะจะกลบความผิดพลาดของ QR
      QR ที่พิมพ์ผิดจะดูเหมือนใช้ได้ แล้วเราจะไม่มีวันรู้ว่ามันพัง

   4. ใช้ 302 ไม่ใช่ 301 + no-store
      301 เบราว์เซอร์จำถาวร พอย้าย X-stand ไปงานใหม่แล้ว deploy
      เครื่องที่เคยสแกนจะยังวิ่งไปที่เดิมตลอดกาล แก้ไม่ได้เลย
      QR ตัวเดียวใช้ซ้ำหลายงานคือทั้งหมดของระบบนี้ จึงห้ามใช้ 301
   ============================================================ */

'use strict';

const act = require('./_lib/activations');

const NOT_FOUND_HTML =
  '<!doctype html><html lang="th"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="robots" content="noindex">' +
  '<title>ไม่พบลิงก์นี้ | VINKO WOW LAB</title>' +
  '<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#FFF9F0;' +
  'color:#071B5D;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}' +
  'h1{font-size:22px;margin:0 0 10px}p{margin:0 0 18px;line-height:1.7;color:#5a6280}' +
  'a{display:inline-block;background:#F5A623;color:#071B5D;text-decoration:none;font-weight:800;' +
  'padding:13px 26px;border-radius:999px}</style>' +
  '<h1>ไม่พบลิงก์นี้</h1>' +
  '<p>ลิงก์อาจพิมพ์ผิดหรือยังไม่เปิดใช้งาน<br>เข้าหน้าแรกแล้วเลือกเมนูที่ต้องการได้เลย</p>' +
  '<a href="/">ไปหน้าแรก VINKO</a>';

/**
 * สร้างตัวจัดการคำขอ
 *
 * รับตารางเข้ามาแทนได้ เพื่อให้เทสต์ตรวจ "เส้นทางสำเร็จ" ได้จริง
 * โดยไม่ต้องเปิด token หน้างานก่อนที่จะตรวจอาร์ตเวิร์กเสร็จ
 * ไม่ส่งอะไรมา = ใช้ตารางจริงใน activations.js
 */
function createHandler(map) {
  return function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end();
      return;
    }

    // อ่านเฉพาะ token พารามิเตอร์อื่นที่แนบมาถูกทิ้งทั้งหมด
    let token = '';
    try {
      const url = new URL(req.url, 'http://localhost');
      token = (url.searchParams.get('token') || '').trim().toLowerCase();
    } catch (e) {
      token = '';
    }

    const r = act.resolve(token, map);

    if (!r.found) {
      // QR พิมพ์ผิด / ยังไม่ยืนยันป้ายกำกับ / มีคนลองเดา token
      console.warn('[vinko][r] ไม่พบหรือยังไม่ยืนยัน:', JSON.stringify(token).slice(0, 60));
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.end(req.method === 'HEAD' ? undefined : NOT_FOUND_HTML);
      return;
    }

    console.log('[vinko][r]', token, '->', r.activation_id);
    res.statusCode = 302;
    res.setHeader('Location', r.url);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.end();
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
