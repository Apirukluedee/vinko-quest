/* ============================================================
   POST /api/create-charge
   สร้างออเดอร์ + charge ของ Omise

   หลักสำคัญ: client ส่งมาได้แค่ package_code
   ราคา server เปิดตารางเองเสมอ ถ้ามี amount ติดมาใน body จะถูกทิ้ง
   ============================================================ */

'use strict';

const catalog = require('./_lib/catalog');
const omise   = require('./_lib/omise');
const db      = require('./_lib/supabase');
const orders  = require('./_lib/orders');
const { json, fail, hashIp, isEmail, isPhone, clean, requireEnv } = require('./_lib/util');
const config  = require('./_lib/config');

const RATE_WINDOW_MIN = 10;
const RATE_MAX_ORDERS = 8;      // ต่อ ip_hash ต่อ 10 นาที

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'วิธีเรียกไม่ถูกต้อง');

  try {
    requireEnv(['OMISE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_BASE_URL']);
  } catch (e) {
    return fail(res, 500, 'ระบบชำระเงินยังไม่พร้อมใช้งาน กรุณาติดต่อร้านค้า', e.message);
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body) return fail(res, 400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง');

  /* ---------- 1. ตรวจ input ---------- */

  const pkg = catalog.getPackage(body.package_code);
  if (!pkg) return fail(res, 400, 'ไม่พบแพ็กเกจที่เลือก กรุณาเลือกใหม่อีกครั้ง');

  const name  = clean(body.customer_name, 120);
  const email = clean(body.customer_email, 254);
  const phone = clean(body.customer_phone, 30);
  const method = body.payment_method === 'card' ? 'card'
               : body.payment_method === 'promptpay' ? 'promptpay' : null;

  if (!name)  return fail(res, 400, 'กรุณากรอกชื่อ-นามสกุล');
  if (!isEmail(email)) return fail(res, 400, 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  if (phone && !isPhone(phone)) return fail(res, 400, 'รูปแบบเบอร์โทรไม่ถูกต้อง');
  if (!method) return fail(res, 400, 'กรุณาเลือกวิธีชำระเงิน');
  if (method === 'card' && !clean(body.card_token, 100)) {
    return fail(res, 400, 'ข้อมูลบัตรไม่ถูกต้อง กรุณากรอกใหม่อีกครั้ง');
  }

  if (!body.consent_terms || !body.consent_privacy) {
    return fail(res, 400, 'กรุณายอมรับเงื่อนไขการซื้อและนโยบายความเป็นส่วนตัวก่อนชำระเงิน');
  }
  // BUNDLE มีสินค้า pre-order จึงต้องมีหลักฐานว่าลูกค้ารับทราบก่อนจ่ายเงิน
  if (pkg.requires_preorder_consent && !body.consent_preorder) {
    return fail(res, 400, 'กรุณายืนยันว่ารับทราบเงื่อนไขสินค้า pre-order ของนิทาน 5 เรื่อง');
  }

  const ipHash = hashIp(req);
  const clientRequestId = clean(body.client_request_id, 64) || null;

  /* ---------- 2. กดปุ่มรัว = ต้องได้ charge เดียว ---------- */

  if (clientRequestId) {
    const dup = await db.select(
      'orders',
      'client_request_id=eq.' + encodeURIComponent(clientRequestId) +
      '&select=order_ref,status,omise_charge_id,payment_method,amount_satang'
    );
    const existing = Array.isArray(dup.body) && dup.body[0];
    if (existing) return json(res, 200, await describeExisting(existing));
  }

  /* ---------- 3. rate limit ---------- */

  try {
    const since = new Date(Date.now() - RATE_WINDOW_MIN * 60000).toISOString();
    const n = await db.count('orders',
      'ip_hash=eq.' + encodeURIComponent(ipHash) + '&created_at=gte.' + encodeURIComponent(since));
    if (n >= RATE_MAX_ORDERS) {
      return fail(res, 429, 'คุณสร้างรายการสั่งซื้อถี่เกินไป กรุณารอสักครู่แล้วลองใหม่');
    }
  } catch (e) {
    console.error('[vinko] rate limit check failed', e.message);  // ตรวจไม่ได้ก็ปล่อยผ่าน ไม่บล็อกการขาย
  }

  /* ---------- 4. ราคาจาก catalog ฝั่ง server เท่านั้น ---------- */

  const amountSatang = catalog.priceSatang(pkg.code);
  if (!amountSatang) return fail(res, 500, 'ไม่สามารถคำนวณราคาได้ กรุณาติดต่อร้านค้า');

  /* ---------- 5. สร้างออเดอร์สถานะ pending ---------- */

  const refRes = await db.rpc('next_order_ref');
  const orderRef = typeof refRes.body === 'string' ? refRes.body : (refRes.body && refRes.body.next_order_ref);
  if (!refRes.ok || !orderRef) {
    return fail(res, 500, 'ไม่สามารถสร้างเลขที่ออเดอร์ได้ กรุณาลองใหม่', JSON.stringify(refRes.body));
  }

  const now = new Date().toISOString();
  const ins = await db.insert('orders', {
    order_ref: orderRef,
    package_code: pkg.code,
    amount_satang: amountSatang,
    currency: 'THB',
    customer_name: name,
    customer_email: email,
    customer_phone: phone || null,
    status: 'pending',
    payment_method: method,
    consent_terms_at: now,
    consent_privacy_at: now,
    consent_preorder_at: pkg.requires_preorder_consent ? now : null,
    ip_hash: ipHash,
    client_request_id: clientRequestId
  });

  if (!ins.ok) {
    if (db.isUniqueViolation(ins) && clientRequestId) {
      const again = await db.select('orders',
        'client_request_id=eq.' + encodeURIComponent(clientRequestId) +
        '&select=order_ref,status,omise_charge_id,payment_method,amount_satang');
      const row = Array.isArray(again.body) && again.body[0];
      if (row) return json(res, 200, await describeExisting(row));
    }
    return fail(res, 500, 'ไม่สามารถบันทึกคำสั่งซื้อได้ กรุณาลองใหม่', JSON.stringify(ins.body));
  }

  const order = Array.isArray(ins.body) ? ins.body[0] : ins.body;
  await db.insertMany('order_items', catalog.buildItems(pkg.code, order.id));

  /* ---------- 6. เรียก Omise ---------- */

  const meta = { order_ref: orderRef, package_code: pkg.code };
  const returnUri = config.appBaseUrl() +
                    '/thank-you?ref=' + encodeURIComponent(orderRef);

  let charge;
  try {
    if (method === 'promptpay') {
      const src = await omise.createSource({
        type: 'promptpay',
        amount: amountSatang,
        currency: 'THB'
      });
      if (!src.ok || !src.body.id) throw new Error('source: ' + JSON.stringify(src.body));

      const ch = await omise.createCharge({
        amount: amountSatang,
        currency: 'THB',
        source: src.body.id,
        return_uri: returnUri,
        description: pkg.title + ' (' + orderRef + ')',
        metadata: meta
      });
      if (!ch.ok || !ch.body.id) throw new Error('charge: ' + JSON.stringify(ch.body));
      charge = ch.body;
    } else {
      // บัตร: รับเฉพาะ token ที่ frontend สร้างด้วย Omise.js
      // เลขบัตรไม่เคยผ่าน server ของเรา
      const ch = await omise.createCharge({
        amount: amountSatang,
        currency: 'THB',
        card: clean(body.card_token, 100),
        return_uri: returnUri,          // สำหรับ 3-D Secure
        description: pkg.title + ' (' + orderRef + ')',
        metadata: meta
      });
      if (!ch.ok || !ch.body.id) throw new Error('charge: ' + JSON.stringify(ch.body));
      charge = ch.body;
    }
  } catch (e) {
    await db.update('orders', 'id=eq.' + order.id, { status: 'failed' });
    return fail(res, 502, 'ไม่สามารถติดต่อระบบชำระเงินได้ กรุณาลองใหม่อีกครั้ง', e.message);
  }

  /* ---------- 7. ผูก charge id กลับเข้าออเดอร์ ---------- */

  await db.update('orders', 'id=eq.' + order.id, { omise_charge_id: charge.id });

  // บัตรที่ผ่านทันที (ไม่ต้อง 3DS) รู้ผลตั้งแต่ตอนนี้ อัปเดตเลยเพื่อไม่ให้ลูกค้ารอ webhook
  // ใช้ตรรกะเดียวกับ webhook จึงเรียกซ้ำได้โดยไม่เกิดผลซ้ำซ้อน
  if (charge.status === 'successful') {
    try { await orders.applyChargeResult(charge); }
    catch (e) { console.error('[vinko] applyChargeResult on create failed', e.message); }
  }

  /* ---------- 8. คืนเฉพาะสิ่งที่ frontend ต้องใช้ ---------- */

  return json(res, 200, {
    ok: true,
    order_ref: orderRef,
    package_code: pkg.code,
    amount_satang: amountSatang,
    payment_method: method,
    charge_status: charge.status,
    qr_image_url: method === 'promptpay' ? omise.promptpayQrUrl(charge) : null,
    expires_at: (charge.source && charge.source.expires_at) || charge.expires_at || null,
    authorize_uri: charge.authorize_uri || null,
    failure_message: charge.status === 'failed'
      ? 'ชำระเงินไม่สำเร็จ กรุณาตรวจสอบข้อมูลบัตรหรือลองวิธีอื่น' : null
  });
};

/* คำขอซ้ำจากการกดปุ่มรัว: คืนออเดอร์เดิม ไม่สร้าง charge ใหม่ */
async function describeExisting(row) {
  const out = {
    ok: true,
    duplicate: true,
    order_ref: row.order_ref,
    amount_satang: row.amount_satang,
    payment_method: row.payment_method,
    charge_status: row.status === 'paid' ? 'successful' : row.status,
    qr_image_url: null,
    expires_at: null,
    authorize_uri: null,
    failure_message: null
  };
  if (row.omise_charge_id && row.status === 'pending') {
    try {
      const ch = await omise.retrieveCharge(row.omise_charge_id);
      if (ch.ok) {
        out.charge_status = ch.body.status;
        out.qr_image_url = omise.promptpayQrUrl(ch.body);
        out.expires_at = (ch.body.source && ch.body.source.expires_at) || null;
        out.authorize_uri = ch.body.authorize_uri || null;
      }
    } catch (e) { console.error('[vinko] retrieve on duplicate failed', e.message); }
  }
  return out;
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
