/* ============================================================
   ส่งอีเมลผ่าน Resend

   ทุกฉบับเป็น HTML แบบ table-based (เปิดได้ทุกโปรแกรมรวม Outlook เก่า)
   และมี plain-text ควบคู่เสมอ ช่วยเรื่อง spam มาก

   ไม่แนบไฟล์ PDF มากับอีเมลเด็ดขาด ใช้ลิงก์อย่างเดียว
   ไฟล์แนบทำให้เข้า spam ง่ายและแนบไปแล้วตามลบไม่ได้
   ============================================================ */

'use strict';

const db = require('./supabase');
const config = require('./config');
const signedToken = require('./signed_token');

const FROM = 'VINKO <hello@mail.vinko.quest>';
const BRAND_ORANGE = '#F59A23';
const BRAND_NAVY = '#071B5D';

function baseUrl() {
  // อีเมลต้องมีลิงก์เสมอ ยอมใช้โดเมนจริงเป็นค่าสำรองดีกว่าส่งอีเมลที่ลิงก์เป็น /download เปล่าๆ
  return config.appBaseUrl() || 'https://vinko.quest';
}

/**
 * ลิงก์หน้าดาวน์โหลด
 *
 * openExternalBrowser=1 เป็นพารามิเตอร์ของ LINE โดยเฉพาะ: ถ้าลูกค้ากดลิงก์นี้
 * จากในแอป LINE ระบบจะเด้งไปเปิดเบราว์เซอร์จริงของเครื่องให้เลย
 *
 * จำเป็นเพราะเบราว์เซอร์ในแอป LINE "เปิดไฟล์ให้ดู" เฉยๆ ไม่ได้บันทึกลงเครื่อง
 * พอปิดหน้าไฟล์หายทันที ลูกค้าเจอปัญหานี้จริงมาแล้ว (หาไฟล์ไม่เจอหลังโหลด)
 * หน้าดาวน์โหลดมีข้อความเตือนอยู่แล้ว แต่แก้ที่ต้นทางดีกว่าให้เขาต้องอ่านแล้วกดเอง
 *
 * เบราว์เซอร์อื่นมองว่าเป็น query string ที่ไม่รู้จักแล้วข้ามไป ไม่มีผลอะไร
 * และ download.js อ่านเฉพาะ token จึงไม่กระทบการทำงาน
 */
function downloadUrl(token) {
  return baseUrl() + '/download?token=' + encodeURIComponent(token) + '&openExternalBrowser=1';
}

function readerUrl(storyNum, readerToken) {
  return baseUrl() + '/read?story=' + storyNum + '&token=' + encodeURIComponent(readerToken) + '&openExternalBrowser=1';
}

/**
 * ลิงก์ "เชื่อมบัญชี LINE" — ฝังอีเมลของคำสั่งซื้อนี้ไว้ใน token ที่เซ็น
 * ด้วย HMAC (signed_token.js) ตอนลูกค้ากดลิงก์นี้แล้วเลือก login ด้วย
 * LINE ระบบจะผูก LINE account เข้ากับอีเมลนี้ทันทีโดยไม่ต้องพิมพ์อีเมล
 * เองเลย (ข้าม need_email ไปเลย — ดู api/auth.js handleLineCallback)
 *
 * คืน null ถ้า LINE Login ยังไม่ได้ตั้งค่า (channel id/secret ว่าง) —
 * ผู้เรียกต้องเช็คก่อนเอาไปใส่ปุ่มในอีเมล ไม่งั้นลูกค้าจะกดแล้วเจอ
 * line_not_configured เปล่าๆ
 */
function connectLineUrl(customerEmail) {
  const secret = config.lineLoginChannelSecret();
  if (!config.lineLoginChannelId() || !secret || !customerEmail) return null;
  const token = signedToken.sign({
    p: 'connect',
    email: String(customerEmail).trim().toLowerCase(),
    exp: Date.now() + 30 * 24 * 3600 * 1000 // 30 วัน — อีเมลอาจถูกเปิดอ่านช้าได้
  }, secret);
  return baseUrl() + '/login?connect_token=' + encodeURIComponent(token) + '&openExternalBrowser=1';
}

function storyNumFromCode(productCode) {
  const m = String(productCode || '').match(/STORY-0?(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function seller() {
  return {
    name: config.sellerName(),
    email: config.contactEmail(),
    line: config.lineUrl()
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function thaiDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00+07:00');
  if (isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + TH_MONTH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

function thaiDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const bkk = new Date(d.getTime() + 7 * 3600 * 1000);
  return bkk.getUTCDate() + ' ' + TH_MONTH[bkk.getUTCMonth()] + ' ' + (bkk.getUTCFullYear() + 543) +
         ' เวลา ' + String(bkk.getUTCHours()).padStart(2, '0') + ':' +
         String(bkk.getUTCMinutes()).padStart(2, '0') + ' น.';
}

/* ---------------- เปลือกอีเมล ---------------- */

function shell(inner) {
  const s = seller();
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/></head>' +
    '<body style="margin:0;padding:0;background:#F4F6FB;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FB;padding:24px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:\'Segoe UI\',Tahoma,Arial,sans-serif;">' +
    '<tr><td style="background:' + BRAND_NAVY + ';padding:20px 26px;">' +
    '<div style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:.5px;">VINKO · WOW LAB</div>' +
    '<div style="color:#B9C4E8;font-size:12px;margin-top:2px;">Little Kitchen. Big Discoveries.</div>' +
    '</td></tr>' +
    '<tr><td style="padding:26px;color:#2A3040;font-size:15px;line-height:1.75;">' + inner + '</td></tr>' +
    '<tr><td style="background:#F7F4EF;padding:18px 26px;color:#6B7285;font-size:12px;line-height:1.7;">' +
    esc(s.name) +
    (s.email ? '<br/>อีเมล: <a href="mailto:' + esc(s.email) + '" style="color:' + BRAND_NAVY + ';">' + esc(s.email) + '</a>' : '') +
    '<br/>LINE: <a href="' + esc(s.line) + '" style="color:' + BRAND_NAVY + ';">' + esc(s.line) + '</a>' +
    '<br/><a href="' + baseUrl() + '/privacy" style="color:#6B7285;">นโยบายความเป็นส่วนตัว</a> · ' +
    '<a href="' + baseUrl() + '/terms" style="color:#6B7285;">เงื่อนไขการซื้อ</a>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function bigButton(url, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto;">' +
    '<tr><td align="center" bgcolor="' + BRAND_ORANGE + '" style="border-radius:999px;">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:15px 34px;color:#ffffff;' +
    'font-size:17px;font-weight:bold;text-decoration:none;border-radius:999px;">' + esc(label) + '</a>' +
    '</td></tr></table>';
}

function noticeBox(html) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="background:#FFF7EC;border-radius:12px;margin:18px 0;"><tr>' +
    '<td style="padding:14px 16px;font-size:13.5px;line-height:1.7;color:#5B4A2E;">' + html +
    '</td></tr></table>';
}

function timelineTable(items) {
  if (!items || !items.length) return '';
  let rows = '';
  for (const it of items) {
    rows += '<tr>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EDF0F7;font-size:14px;color:#2A3040;">' + esc(it.title) + '</td>' +
      '<td style="padding:7px 0;border-bottom:1px solid #EDF0F7;font-size:14px;color:#6B7285;text-align:right;white-space:nowrap;">' +
      esc(thaiDate(it.scheduled_delivery_date) || 'รอกำหนด') + '</td></tr>';
  }
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;">' + rows + '</table>';
}

/* ---------------- อีเมล A: ยืนยันการสั่งซื้อ ---------------- */

/* ชื่อสั้นของแพ็กเกจสำหรับหัวเรื่องอีเมล — ใช้ชื่อเต็มจาก catalog ไม่ได้
   เพราะยาวเกินกว่าที่กล่องจดหมายจะแสดงหมด แต่จะเขียนตายตัวก็ไม่ได้
   คนซื้อนิทานอย่างเดียวจะได้อีเมลหัวเรื่องว่า WOW LAB ซึ่งไม่ใช่ของที่เขาซื้อ */
const SUBJECT_NAME = {
  LAB:     'VINKO WOW LAB',
  STORIES: 'VINKO STORIES',
  BUNDLE:  'VINKO WOW LAB + STORIES'
};

/* กล่อง "เชื่อมบัญชี LINE" — เผื่อไม่ได้ตั้งค่า LINE Login ไว้
   (connectLineUrl คืน null) จะไม่แสดงกล่องนี้เลย ไม่ใช่แสดงปุ่มพังๆ */
function connectLineBox(url) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="background:' + BRAND_NAVY + ';border-radius:12px;margin:20px 0;">' +
    '<tr><td style="padding:18px 20px;">' +
    '<p style="margin:0 0 4px;color:' + BRAND_ORANGE + ';font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">เข้าดูหนังสือเร็วขึ้นในครั้งหน้า</p>' +
    '<p style="margin:0 0 6px;color:#ffffff;font-size:16px;font-weight:bold;line-height:1.4;">🔗 เชื่อมบัญชี LINE กับคำสั่งซื้อนี้</p>' +
    '<p style="margin:0 0 14px;color:#B9C4E8;font-size:13.5px;line-height:1.6;">กดครั้งเดียว ครั้งต่อไปกด "เข้าสู่ระบบด้วย LINE" เข้า My Library ได้เลย ไม่ต้องเปิดอีเมลหาอีกแล้ว</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td align="center" bgcolor="' + BRAND_ORANGE + '" style="border-radius:999px;">' +
    '<a href="' + esc(url) + '" style="display:inline-block;padding:11px 26px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:999px;">เชื่อมบัญชี LINE</a>' +
    '</td></tr></table>' +
    '</td></tr></table>';
}

function purchaseEmail(o) {
  const url = downloadUrl(o.token);
  const pkgName = SUBJECT_NAME[o.packageCode] || 'VINKO';
  const hasPreorderStories = o.packageCode === 'BUNDLE' || o.packageCode === 'STORIES';
  const preorders = (o.items || []).filter(function (i) { return i.delivery_type === 'preorder'; });
  const connectUrl = o.customerEmail ? connectLineUrl(o.customerEmail) : null;

  let inner =
    '<p style="margin:0 0 12px;font-size:19px;font-weight:bold;color:' + BRAND_NAVY + ';">ขอบคุณมากครับ 🎉</p>' +
    '<p style="margin:0 0 6px;">คำสั่งซื้อของคุณเรียบร้อยแล้ว ไฟล์พร้อมให้ดาวน์โหลดทันที</p>' +
    '<p style="margin:0 0 4px;color:#6B7285;font-size:13.5px;">เลขที่คำสั่งซื้อ <b style="color:' + BRAND_NAVY + ';">' + esc(o.orderRef) + '</b></p>' +
    '<p style="margin:0 0 4px;color:#6B7285;font-size:13.5px;">รายการ: ' + esc(o.packageTitle) + '</p>' +
    bigButton(url, 'ดาวน์โหลดไฟล์ของคุณ') +
    noticeBox('<b>ลิงก์นี้ใช้ได้ถึง ' + esc(thaiDateTime(o.expiresAt)) + '</b><br/>' +
              'กรุณาดาวน์โหลดแล้ว<b>บันทึกไฟล์เก็บไว้ในเครื่อง</b> ถ้าลิงก์หมดอายุก่อน ' +
              'กดขอลิงก์ใหม่ได้ที่หน้าดาวน์โหลด หรือทักมาหาเราได้เลย');

  if (hasPreorderStories && preorders.length) {
    inner += '<p style="margin:20px 0 4px;font-weight:bold;color:' + BRAND_NAVY + ';">กำหนดส่งนิทานเล่มถัดไป</p>' +
      '<p style="margin:0;color:#6B7285;font-size:13.5px;">เราจะส่งอีเมลพร้อมลิงก์ให้ทุกครั้งที่มีเรื่องใหม่ ไม่ต้องเข้ามาเช็กเอง</p>' +
      timelineTable(preorders);
  }

  // reader links สำหรับนิทานที่ส่งมอบแล้ว (instant)
  if (o.readerToken) {
    const instantStories = (o.items || []).filter(function (i) {
      return i.delivery_type === 'instant' && !i.refunded_at &&
             storyNumFromCode(i.product_code) !== null;
    });
    if (instantStories.length) {
      inner += '<p style="margin:24px 0 6px;font-weight:bold;color:' + BRAND_NAVY + ';">🎧 ฟังนิทานเสียงออนไลน์</p>';
      inner += '<p style="margin:0 0 10px;color:#6B7285;font-size:13.5px;">คลิกปุ่มด้านล่างเพื่ออ่านและฟังเสียงประกอบได้เลย ไม่ต้องดาวน์โหลด</p>';
      for (const it of instantStories) {
        const num = storyNumFromCode(it.product_code);
        inner += bigButton(readerUrl(num, o.readerToken), 'เปิดอ่าน ' + esc(it.title));
      }
    }
  }

  if (connectUrl) inner += connectLineBox(connectUrl);

  inner += '<p style="margin:18px 0 0;color:#6B7285;font-size:13px;line-height:1.7;">' +
    'ไฟล์ของคุณมีลายน้ำระบุชื่อและเลขที่คำสั่งซื้อกำกับไว้ทุกหน้า ' +
    'เพื่อให้เราดูแลผลงานได้ต่อไป รบกวนเก็บไว้ใช้ในครอบครัวนะครับ 🙏</p>';

  const text =
    'ขอบคุณมากครับ\n\n' +
    'คำสั่งซื้อของคุณเรียบร้อยแล้ว\n' +
    'เลขที่คำสั่งซื้อ: ' + o.orderRef + '\n' +
    'รายการ: ' + o.packageTitle + '\n\n' +
    'ดาวน์โหลดไฟล์: ' + url + '\n\n' +
    'ลิงก์ใช้ได้ถึง ' + thaiDateTime(o.expiresAt) + ' กรุณาบันทึกไฟล์เก็บไว้ในเครื่อง\n\n' +
    (hasPreorderStories && preorders.length
      ? 'กำหนดส่งนิทาน:\n' + preorders.map(function (i) {
          return '  - ' + i.title + ' : ' + (thaiDate(i.scheduled_delivery_date) || 'รอกำหนด');
        }).join('\n') + '\n\n'
      : '') +
    (connectUrl ? 'เชื่อมบัญชี LINE เพื่อเข้าดูหนังสือได้เร็วขึ้นครั้งหน้า: ' + connectUrl + '\n\n' : '') +
    'ไฟล์มีลายน้ำระบุตัวผู้ซื้อทุกหน้า กรุณาเก็บไว้ใช้ในครอบครัว\n\n' +
    seller().name + (seller().email ? ' · ' + seller().email : '') + '\n' + seller().line + '\n';

  return { subject: 'ดาวน์โหลด ' + pkgName + ' ของคุณได้เลย · ' + o.orderRef, html: shell(inner), text: text };
}

/* ---------------- อีเมล B: ส่งมอบนิทาน ---------------- */

function storyEmail(o) {
  const url = downloadUrl(o.token);
  const libraryUrl = baseUrl() + '/library?openExternalBrowser=1';
  const libraryBox =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="background:' + BRAND_NAVY + ';border-radius:12px;margin:20px 0;">' +
    '<tr><td style="padding:18px 20px;">' +
    '<p style="margin:0 0 4px;color:' + BRAND_ORANGE + ';font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">VINKO Reader Book</p>' +
    '<p style="margin:0 0 6px;color:#ffffff;font-size:16px;font-weight:bold;line-height:1.4;">🎧 ฟังเสียงอ่านได้เลย ไม่ต้องหาอีเมล</p>' +
    '<p style="margin:0 0 14px;color:#B9C4E8;font-size:13.5px;line-height:1.6;">เข้า My Library ด้วย LINE หรืออีเมล เห็นหนังสือทุกเล่มที่ซื้อไว้ และกดฟังเสียงได้ทันที</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td align="center" bgcolor="' + BRAND_ORANGE + '" style="border-radius:999px;">' +
    '<a href="' + esc(libraryUrl) + '" style="display:inline-block;padding:11px 26px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:999px;">📚 เข้า My Library</a>' +
    '</td></tr></table>' +
    '</td></tr></table>';

  const inner =
    '<p style="margin:0 0 12px;font-size:19px;font-weight:bold;color:' + BRAND_NAVY + ';">นิทานเรื่องใหม่มาแล้ว 📖</p>' +
    '<p style="margin:0 0 6px;"><b>' + esc(o.itemTitle) + '</b> พร้อมให้ดาวน์โหลดแล้วครับ</p>' +
    '<p style="margin:0 0 4px;color:#6B7285;font-size:13.5px;">เลขที่คำสั่งซื้อ <b style="color:' + BRAND_NAVY + ';">' + esc(o.orderRef) + '</b></p>' +
    bigButton(url, 'ดาวน์โหลดนิทานเรื่องนี้') +
    noticeBox('<b>ลิงก์ใช้ได้ถึง ' + esc(thaiDateTime(o.expiresAt)) + '</b><br/>' +
              'ลิงก์เดิมนี้เปิดได้ทุกไฟล์ที่คุณซื้อไว้ ไม่ใช่เฉพาะเรื่องใหม่') +
    libraryBox +
    (o.remaining && o.remaining.length
      ? '<p style="margin:20px 0 4px;font-weight:bold;color:' + BRAND_NAVY + ';">เรื่องที่เหลือ</p>' + timelineTable(o.remaining)
      : '<p style="margin:18px 0 0;color:#6B7285;font-size:13.5px;">นี่คือนิทานเรื่องสุดท้ายในชุดแล้ว ขอบคุณที่รอจนครบนะครับ 🙏</p>');

  const text =
    'นิทานเรื่องใหม่มาแล้ว\n\n' + o.itemTitle + ' พร้อมให้ดาวน์โหลดแล้ว\n' +
    'เลขที่คำสั่งซื้อ: ' + o.orderRef + '\n\n' +
    'ดาวน์โหลด: ' + url + '\n\n' +
    'ลิงก์ใช้ได้ถึง ' + thaiDateTime(o.expiresAt) + '\n\n' +
    '🎧 ฟังเสียงอ่านได้เลยที่ My Library (ไม่ต้องหาอีเมล)\n' +
    baseUrl() + '/library\n\n' +
    seller().name + '\n' + seller().line + '\n';

  return { subject: esc(o.itemTitle) + ' พร้อมดาวน์โหลดแล้ว · ' + o.orderRef, html: shell(inner), text: text };
}

/* ---------------- อีเมล C: ขอลิงก์ใหม่ ---------------- */

function resendEmail(o) {
  const url = downloadUrl(o.token);
  const inner =
    '<p style="margin:0 0 12px;font-size:19px;font-weight:bold;color:' + BRAND_NAVY + ';">ลิงก์ดาวน์โหลดใหม่ของคุณ</p>' +
    '<p style="margin:0 0 6px;">ตามที่ขอมาครับ ลิงก์ด้านล่างใช้ได้อีก 48 ชั่วโมง</p>' +
    '<p style="margin:0 0 4px;color:#6B7285;font-size:13.5px;">เลขที่คำสั่งซื้อ <b style="color:' + BRAND_NAVY + ';">' + esc(o.orderRef) + '</b></p>' +
    bigButton(url, 'เปิดหน้าดาวน์โหลด') +
    noticeBox('<b>ใช้ได้ถึง ' + esc(thaiDateTime(o.expiresAt)) + '</b><br/>' +
              'ลิงก์เดิมจะใช้ไม่ได้แล้วหลังจากนี้ กรุณาใช้ลิงก์ในอีเมลฉบับนี้แทน ' +
              'ขออภัยในความไม่สะดวกครับ');

  const text =
    'ลิงก์ดาวน์โหลดใหม่ของคุณ\n\nเลขที่คำสั่งซื้อ: ' + o.orderRef + '\n\n' + url +
    '\n\nใช้ได้ถึง ' + thaiDateTime(o.expiresAt) +
    '\nลิงก์เดิมจะใช้ไม่ได้แล้วหลังจากนี้ กรุณาใช้ลิงก์ในอีเมลฉบับนี้แทน ขออภัยในความไม่สะดวกครับ\n\n' +
    seller().name + '\n' + seller().line + '\n';

  return { subject: 'ลิงก์ดาวน์โหลดใหม่ · ' + o.orderRef, html: shell(inner), text: text };
}

/* ---------------- ส่งจริง ---------------- */

async function send(kind, toEmail, payload, meta) {
  const apiKey = config.resendApiKey();
  const rec = {
    order_id: (meta && meta.orderId) || null,
    order_item_id: (meta && meta.orderItemId) || null,
    kind: kind,
    to_email: toEmail,
    subject: payload.subject
  };

  if (!apiKey) {
    rec.status = 'failed';
    rec.error = 'ENV_MISSING: RESEND_API_KEY';
    await logEvent(rec);
    return { ok: false, error: rec.error };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [toEmail],
        subject: payload.subject,
        html: payload.html,
        text: payload.text        // ส่งคู่เสมอ ช่วยไม่ให้เข้า spam
      })
    });
    const body = await res.json().catch(function () { return {}; });

    if (!res.ok) {
      rec.status = 'failed';
      rec.error = String(body.message || res.status).slice(0, 400);
      await logEvent(rec);
      return { ok: false, error: rec.error };
    }

    rec.status = 'sent';
    rec.provider_message_id = body.id || null;
    await logEvent(rec);
    return { ok: true, id: body.id };
  } catch (e) {
    rec.status = 'failed';
    rec.error = String(e.message).slice(0, 400);
    await logEvent(rec);
    return { ok: false, error: rec.error };
  }
}

async function logEvent(rec) {
  try {
    await db.insert('email_events', rec);
  } catch (e) {
    console.error('[vinko] บันทึก email_events ไม่สำเร็จ', e.message);
  }
}

module.exports = {
  FROM, purchaseEmail, storyEmail, resendEmail, send, connectLineUrl,
  thaiDate, thaiDateTime, maskless: esc
};
