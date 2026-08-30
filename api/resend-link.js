/* ============================================================
   POST /api/resend-link

   Path A — { token }
     ส่งลิงก์ใหม่ผ่าน token เก่าที่หมดอายุ (ปุ่มใน /download)
     ส่งไปที่อีเมลเดิมของออเดอร์เท่านั้น ไม่รับอีเมลจากผู้ใช้

   Path B — { email, order_ref? }
     ลูกค้ากรอกอีเมลที่ใช้สั่งซื้อ (จากเมนู LINE หรือหน้า /resend-link)

     **อีเมลคือสิ่งที่บังคับ ส่วนเลขที่คำสั่งซื้อเป็นตัวเลือก**
     เพราะ order_ref ออกเป็นเลขเรียงลำดับจึงเดาได้ (ดูคอมเมนต์ใน
     claim-download.js) มันไม่ได้กันใครอยู่จริง แต่กันลูกค้าตัวจริง
     ที่หาอีเมลยืนยันไม่เจอออกไปหมด — ซึ่งเป็นคนกลุ่มเดียวที่ต้องใช้
     หน้านี้ ความปลอดภัยจริงมาจากการที่ลิงก์ถูกส่งเข้ากล่องจดหมาย
     ของเจ้าของอีเมลเท่านั้น คนกรอกอีเมลคนอื่นจึงไม่ได้อะไรกลับไป

     ตอบ generic OK เสมอ ไม่ว่าจะเจอออเดอร์หรือไม่ ป้องกัน enumeration
   ============================================================ */
'use strict';

const db     = require('./_lib/supabase');
const tokens = require('./_lib/tokens');
const email  = require('./_lib/email');
const { json, fail, hashIp, requireEnv } = require('./_lib/util');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REF_RE   = /^VK-\d{4}-\d{4,6}$/;

/* คนหนึ่งอาจซื้อหลายรอบ (ซื้อ LAB ก่อน แล้วค่อยซื้อ STORIES เพิ่ม)
   ต้องส่งให้ครบทุกออเดอร์ ไม่งั้นเขาจะได้ไฟล์กลับมาไม่ครบแล้วงง
   แต่ต้องจำกัดจำนวนไว้ ไม่ให้คนสุ่มอีเมลคนอื่นยิงเมลถล่มได้ */
const MAX_ORDERS = 3;

const GENERIC_MSG = 'ถ้าอีเมลนี้เคยสั่งซื้อกับเรา ลิงก์ดาวน์โหลดใหม่ถูกส่งไปแล้ว ' +
                    'กรุณาตรวจกล่องจดหมาย และโฟลเดอร์ junk ด้วยนะครับ';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');
  try {
    requireEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  } catch (e) {
    return fail(res, 500, 'ระบบยังไม่พร้อมใช้งาน', e.message);
  }

  hashIp(req);   // ให้แน่ใจว่ามี salt ตั้งไว้ (จะโยน error ตั้งแต่ตอน deploy ถ้าลืม)

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = body && typeof body.token === 'string' ? body.token : '';

  /* ─── Path B: email (+ order_ref ถ้าจำได้) ─────────────────── */
  if (!token) {
    const givenEmail = body && typeof body.email     === 'string' ? body.email.trim().toLowerCase() : '';
    const rawRef     = body && typeof body.order_ref === 'string' ? body.order_ref.trim().toUpperCase() : '';

    if (!EMAIL_RE.test(givenEmail)) {
      return fail(res, 400, 'กรุณากรอกอีเมลที่ใช้สั่งซื้อให้ถูกต้อง');
    }
    // เลขที่คำสั่งซื้อไม่บังคับ แต่ถ้าอุตส่าห์กรอกมาแล้วผิดรูปแบบ ต้องบอก
    // ไม่งั้นเขาจะรอเมลที่ไม่มีวันมาโดยไม่รู้ว่าพิมพ์ผิด
    if (rawRef && !REF_RE.test(rawRef)) {
      return fail(res, 400, 'เลขที่คำสั่งซื้อไม่ถูกต้อง ต้องเป็นรูปแบบ VK-2608-0001 (เว้นว่างไว้ก็ได้)');
    }

    // customer_email เก็บตามที่ลูกค้าพิมพ์มา ไม่ได้แปลงเป็นตัวพิมพ์เล็ก
    // จึงค้นแบบไม่สนตัวพิมพ์ แล้วไปยืนยันตัวต่อตัวอีกชั้นในลูปข้างล่าง
    let q = 'customer_email=ilike.' + encodeURIComponent(likeLiteral(givenEmail)) +
            '&status=eq.paid' +
            '&select=id,order_ref,customer_email' +
            '&order=created_at.desc&limit=' + MAX_ORDERS;
    if (rawRef) q += '&order_ref=eq.' + encodeURIComponent(rawRef);

    let orders = [];
    try {
      const r2 = await db.select('orders', q);
      orders = Array.isArray(r2.body) ? r2.body : [];
    } catch (e) {
      console.error('[vinko][resend-b] ค้นออเดอร์ไม่สำเร็จ', e.message);
    }

    for (const o of orders) {
      // ด่านสุดท้าย: ส่งได้เฉพาะเมื่ออีเมลตรงกันเป๊ะจริงๆ
      // ถ้า ilike คืนแถวเกินมาด้วยเหตุใดก็ตาม ตรงนี้จะกันไว้ไม่ให้ส่งผิดคน
      if ((o.customer_email || '').trim().toLowerCase() !== givenEmail) continue;

      try {
        const since = new Date(Date.now() - 10 * 60000).toISOString();
        const recent = await db.count('email_events',
          'order_id=eq.' + o.id + '&kind=eq.resend_link&created_at=gte.' + encodeURIComponent(since));
        if (recent >= 3) continue;   // ออเดอร์นี้ขอถี่เกินไป ข้ามไป แต่ยังตอบ OK เหมือนเดิม

        const t = await tokens.issue(o.id);
        const fresh = await db.select('orders', 'id=eq.' + o.id + '&select=token_expires_at&limit=1');
        const exp = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                    tokens.expiryFromNow();

        const payload = email.resendEmail({ orderRef: o.order_ref, token: t, expiresAt: exp });
        await email.send('resend_link', o.customer_email, payload, { orderId: o.id });
      } catch (e) {
        // ล้มออเดอร์เดียวไม่ควรทำให้ออเดอร์ที่เหลือไม่ได้ส่ง และห้ามเปลี่ยนคำตอบ
        // ที่ส่งกลับไป ไม่งั้นจะกลายเป็นช่องให้เดาว่าอีเมลไหนมีออเดอร์อยู่จริง
        console.error('[vinko][resend-b]', o.order_ref, e.message);
      }
    }

    return json(res, 200, { ok: true, message: GENERIC_MSG });
  }

  /* ─── Path A: token ────────────────────────────────────────── */
  // token ที่หมดอายุยังต้องขอลิงก์ใหม่ได้ จึงหาออเดอร์ตรงๆ ไม่ใช้ resolve()
  if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return fail(res, 400, 'ลิงก์ไม่ถูกต้อง');
  }

  const r = await db.select('orders',
    'download_token=eq.' + encodeURIComponent(token) +
    '&select=id,order_ref,status,customer_email,download_token&limit=1');
  const order = Array.isArray(r.body) && r.body[0];
  if (!order || order.status !== 'paid') return fail(res, 404, 'ไม่พบคำสั่งซื้อนี้');

  // กันกดรัวจนอีเมลท่วม
  const since = new Date(Date.now() - 10 * 60000).toISOString();
  const recent = await db.count('email_events',
    'order_id=eq.' + order.id + '&kind=eq.resend_link&created_at=gte.' + encodeURIComponent(since));
  if (recent >= 3) {
    return fail(res, 429, 'ขอลิงก์ใหม่ถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง');
  }

  const newToken = await tokens.issue(order.id);
  const fresh = await db.select('orders', 'id=eq.' + order.id + '&select=token_expires_at&limit=1');
  const expiresAt = (Array.isArray(fresh.body) && fresh.body[0] && fresh.body[0].token_expires_at) ||
                    tokens.expiryFromNow();

  const payload = email.resendEmail({ orderRef: order.order_ref, token: newToken, expiresAt: expiresAt });
  const out = await email.send('resend_link', order.customer_email, payload, { orderId: order.id });

  if (!out.ok) return fail(res, 502, 'ส่งอีเมลไม่สำเร็จ กรุณาติดต่อเราทาง LINE', out.error);
  return json(res, 200, { ok: true, message: 'ส่งลิงก์ใหม่ไปที่อีเมลเดิมของคุณแล้ว' });
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/** หนีอักขระพิเศษของ LIKE เพื่อให้ค่าที่ใส่มาถูกใช้เป็นข้อความตรงๆ
    อีเมลมี `_` ได้จริง (เช่น my_name@example.com) ถ้าไม่หนี `_` จะกลาย
    เป็นไวลด์การ์ดที่แมตช์อักขระอะไรก็ได้ ทำให้ดึงแถวของคนอื่นติดมาด้วย */
function likeLiteral(s) { return String(s).replace(/([\\%_])/g, '\\$1'); }
