/* ============================================================
   ใส่ลายน้ำระบุตัวผู้ซื้อลงไฟล์ PDF

   ทำสดตอนลูกค้ากดโหลดเท่านั้น ไม่เก็บไฟล์ที่ใส่ลายน้ำแล้วไว้ที่ไหน
   ไฟล์ที่ทำไว้ล่วงหน้าแล้วนอนรออยู่ คือไฟล์ที่รั่วได้

   ต้องฝังฟอนต์ไทยเอง — StandardFonts ของ PDF ไม่มีสระและวรรณยุกต์ไทย
   ถ้าไม่ฝัง ลายน้ำจะออกมาเป็นช่องว่างหรือเครื่องหมายคำถาม
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT_PATH = path.join(__dirname, '..', '_assets', 'fonts', 'Sarabun-Regular.ttf');

let fontCache = null;
function fontBytes() {
  if (!fontCache) fontCache = fs.readFileSync(FONT_PATH);
  return fontCache;
}

/**
 * ปกปิดอีเมลบางส่วน: somchai@gmail.com -> som***@gmail.com
 * ระบุตัวผู้ซื้อได้ แต่ถ้าลูกค้าเผลอแชร์ภาพหน้าจอ อีเมลเต็มก็ไม่หลุด
 */
function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  const user = s.slice(0, at);
  const domain = s.slice(at);
  const keep = user.length <= 3 ? Math.max(1, user.length - 1) : 3;
  return user.slice(0, keep) + '***' + domain;
}

/**
 * ใส่ลายน้ำทุกหน้าที่ขอบล่าง
 *
 * @param {Buffer|Uint8Array} pdfBytes ไฟล์ต้นฉบับ
 * @param {object} info  { orderRef, customerName, customerEmail, title }
 * @returns {Promise<{bytes: Uint8Array, pages: number, ms: number}>}
 */
async function stamp(pdfBytes, info) {
  const t0 = Date.now();

  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);

  // subset:true ฝังเฉพาะตัวอักษรที่ใช้จริง ไฟล์จึงโตขึ้นแค่ไม่กี่ KB
  const font = await doc.embedFont(fontBytes(), { subset: true });

  const line = [
    'ลิขสิทธิ์ VINKO',
    'ผู้ซื้อ: ' + (info.customerName || '-'),
    maskEmail(info.customerEmail),
    info.orderRef
  ].join(' · ');

  const pages = doc.getPages();
  for (const page of pages) {
    const { width } = page.getSize();

    // วางในขอบล่างซึ่งเป็นพื้นที่ว่างของหน้า ไม่ทับเนื้อหาและไม่กวนตอนพิมพ์
    // ลูกค้าซื้อไปเพื่อพิมพ์ worksheet ให้ลูกทำ ลายน้ำจึงต้องไม่รบกวนการใช้งาน
    let size = 7;
    let textWidth = font.widthOfTextAtSize(line, size);
    const maxWidth = width - 56;
    while (textWidth > maxWidth && size > 4.5) {
      size -= 0.25;
      textWidth = font.widthOfTextAtSize(line, size);
    }

    page.drawText(line, {
      x: (width - textWidth) / 2,
      y: 11,
      size: size,
      font: font,
      color: rgb(0.42, 0.44, 0.5),
      opacity: 0.35
    });
  }

  // ฝังไว้ใน metadata อีกชั้น เผื่อมีคนครอปขอบล่างออก
  doc.setSubject('VINKO WOW LAB · ' + info.orderRef);
  doc.setKeywords(['VINKO', info.orderRef, maskEmail(info.customerEmail)]);
  doc.setProducer('VINKO WOW LAB');
  doc.setCreator('VINKO WOW LAB');
  if (info.title) doc.setTitle(info.title);

  // ไม่ใส่รหัสผ่านหรือ encryption โดยตั้งใจ
  // จะทำให้ลูกค้าเปิดบนมือถือไม่ได้และพิมพ์ไม่ได้ ก่อปัญหามากกว่าที่ป้องกันได้

  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes: bytes, pages: pages.length, ms: Date.now() - t0 };
}

/** ชื่อไฟล์ภาษาไทยที่อ่านรู้เรื่อง ปลอดภัยพอสำหรับ header */
function safeFilename(title, orderRef) {
  const base = String(title || 'VINKO')
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return base + ' - ' + orderRef + '.pdf';
}

/** Content-Disposition ที่รองรับชื่อไฟล์ภาษาไทย (RFC 5987) */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
}

module.exports = { stamp, maskEmail, safeFilename, contentDisposition, FONT_PATH };
