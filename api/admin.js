/* ============================================================
   POST /api/admin   { action, ... }
   header: x-vinko-admin: <ADMIN_SECRET>

   เครื่องมือของแอดมินทั้งหมดรวมไว้ที่ไฟล์เดียว

   ที่ต้องรวมเพราะ Vercel Hobby จำกัด serverless function ไว้ 12 ตัว
   ต่อ deployment ถ้าแยกไฟล์ละ endpoint จะเต็มโควตาแล้ว deploy ล้มทั้งชุด
   เพิ่ม action ใหม่ที่นี่ได้เรื่อยๆ โดยไม่กินโควตาเพิ่ม

   action ที่รองรับ:
     resend-email   { order_ref }                     ออก token ใหม่แล้วส่งอีเมลซ้ำ
     test-line                                       ยิงข้อความทดสอบเข้า LINE ของแอดมิน
     refund-status  { order_ref }                    ดูสถานะคืนเงิน เทียบ DB กับ Omise
     refund         { order_ref, scope, note }       บันทึกการคืนเงินและตัดสิทธิ์โหลด
     manual-order   { customer_name, customer_email, customer_phone?,
                       package_code? | items[], note? }
                                                       สร้างออเดอร์ใหม่ + ตั้ง paid ทันที + ส่งอีเมล/ออกลิงก์
                                                       (ใช้ตอนลูกค้าโอนเงินตรง/สลิปทาง LINE ที่หน้าบูธ
                                                        ไม่ผ่าน Omise เลย)
     mark-paid      { order_ref, note? }              ตั้งออเดอร์ที่มีอยู่แล้ว (pending) เป็น paid ด้วยมือ
                                                       + ส่งอีเมล/ออกลิงก์ (ใช้ตอนลูกค้ากดจ่ายผ่านเว็บ QR
                                                        ของ Omise ไว้แล้วแต่ webhook ไม่มา/ช้า)

   หมายเหตุ: action refund ไม่ได้สั่งคืนเงินเอง เจ้าของต้องกดคืนที่แดชบอร์ด
   Omise ก่อน แล้วตัวนี้จะไปยืนยันกับ Omise ว่าคืนจริงถึงจะยอมตัดสิทธิ์

   หมายเหตุ: manual-order / mark-paid บันทึก payment_method เป็น 'promptpay'
   เสมอ (ค่าที่ schema อนุญาตอยู่แล้ว ไม่ใช่การจ่ายผ่าน Omise จริง) เพื่อไม่ต้อง
   แก้ constraint ของ DB แบบเร่งด่วน — note ที่แอดมินกรอกจะขึ้น log เท่านั้น
   ยังไม่มีคอลัมน์เก็บถาวรใน DB
   ============================================================ */
'use strict';

const { deliver } = require('./_lib/deliver-order');
const line = require('./_lib/line');
const refunds = require('./_lib/refunds');
const catalog = require('./_lib/catalog');
const db = require('./_lib/supabase');
const { json, safeEqual, isEmail, clean } = require('./_lib/util');
const config = require('./_lib/config');

const ORDER_REF_RE = /^VK-\d{4}-\d{4,6}$/;

async function downloadLinkFor(orderRef) {
  const r = await db.select('orders',
    'order_ref=eq.' + encodeURIComponent(orderRef) + '&select=download_token&limit=1');
  const row = Array.isArray(r.body) && r.body[0];
  if (!row || !row.download_token) return null;
  const base = config.appBaseUrl() || 'https://vinko.quest';
  return base + '/download?token=' + encodeURIComponent(row.download_token) + '&openExternalBrowser=1';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  const secret = config.adminSecret();
  const given = req.headers['x-vinko-admin'];
  if (!secret || secret.length < 16 || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false, error: 'ไม่ได้รับอนุญาต' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const action = body && typeof body.action === 'string' ? body.action.trim() : '';

  try {
    if (action === 'test-line') {
      const out = await line.notifyTest();
      return json(res, out.ok ? 200 : 400, out);
    }

    if (action === 'resend-email') {
      const ref = typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
      if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) {
        return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });
      }
      // force = ออก token ใหม่และส่งอีเมลซ้ำเสมอ แม้เคยส่งไปแล้ว
      const out = await deliver(ref, { force: true });
      return json(res, out.ok ? 200 : 400, out);
    }

    if (action === 'refund-status' || action === 'refund') {
      const ref = typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
      if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) {
        return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });
      }

      if (action === 'refund-status') {
        const out = await refunds.status(ref);
        return json(res, out.ok ? 200 : 404, out);
      }

      const scope = body.scope === 'preorder' ? 'preorder' : 'full';
      const out = await refunds.record(ref, { scope: scope, note: body.note });
      if (out.ok && !out.already) {
        // แจ้ง LINE ไว้เป็นหลักฐานว่าตัดสิทธิ์เมื่อไหร่ ออเดอร์ไหน
        // แจ้งไม่สำเร็จก็ไม่ถือว่าล้มเหลว การคืนเงินบันทึกลง DB ไปแล้ว
        await line.notifyRefund(out.order_ref, scope, out.refund_satang)
          .catch(function (e) {
            console.error('[vinko][admin] แจ้ง LINE เรื่องคืนเงินไม่สำเร็จ', e.message);
          });
      }
      return json(res, out.ok ? 200 : 400, out);
    }

    if (action === 'manual-order') {
      const name  = clean(body.customer_name, 120);
      const email = clean(body.customer_email, 254);
      const phone = clean(body.customer_phone, 30);
      const note  = clean(body.note, 300);

      if (!name) return json(res, 400, { ok: false, error: 'กรุณากรอกชื่อ-นามสกุล' });
      if (!isEmail(email)) return json(res, 400, { ok: false, error: 'รูปแบบอีเมลไม่ถูกต้อง' });

      const isCart = Array.isArray(body.items) && body.items.length > 0;
      const cartCodes = isCart
        ? Array.from(new Set(body.items.map(function (c) { return String(c).toUpperCase(); })
            .filter(catalog.isSingleSellable)))
        : [];
      if (isCart && !cartCodes.length) {
        return json(res, 400, { ok: false, error: 'รายการหนังสือไม่ถูกต้อง' });
      }

      const pkg = isCart ? null : catalog.getPackage(body.package_code);
      if (!isCart && !pkg) return json(res, 400, { ok: false, error: 'ไม่พบแพ็กเกจที่เลือก' });

      const packageCode = isCart ? 'CUSTOM' : pkg.code;
      const amountSatang = isCart ? catalog.customCartTotal(cartCodes) : catalog.priceSatang(pkg.code);
      if (!amountSatang) return json(res, 400, { ok: false, error: 'คำนวณราคาไม่ได้' });

      const refRes = await db.rpc('next_order_ref');
      const orderRef = typeof refRes.body === 'string' ? refRes.body : (refRes.body && refRes.body.next_order_ref);
      if (!refRes.ok || !orderRef) {
        return json(res, 500, { ok: false, error: 'สร้างเลขที่ออเดอร์ไม่ได้', detail: refRes.body });
      }

      console.log('[vinko][admin] manual-order', orderRef, 'note:', note || '(ไม่มี)');

      const now = new Date().toISOString();
      const ins = await db.insert('orders', {
        order_ref: orderRef,
        package_code: packageCode,
        amount_satang: amountSatang,
        currency: 'THB',
        customer_name: name,
        customer_email: email,
        customer_phone: phone || null,
        status: 'paid',
        payment_method: 'promptpay',
        consent_terms_at: now,
        consent_privacy_at: now,
        paid_at: now
      });
      if (!ins.ok) {
        return json(res, 500, { ok: false, error: 'บันทึกออเดอร์ไม่สำเร็จ', detail: ins.body });
      }

      const order = Array.isArray(ins.body) ? ins.body[0] : ins.body;
      const orderItems = isCart ? catalog.buildCustomItems(cartCodes, order.id) : catalog.buildItems(pkg.code, order.id);
      const itemsIns = await db.insertMany('order_items', orderItems);
      if (!itemsIns.ok) {
        return json(res, 500, {
          ok: false, error: 'บันทึกรายการหนังสือไม่สำเร็จ (ออเดอร์ ' + orderRef + ' ค้างอยู่ ต้องแก้มือ)',
          order_ref: orderRef, detail: itemsIns.body
        });
      }

      const out = await deliver(orderRef, { force: true });
      const link = await downloadLinkFor(orderRef).catch(function () { return null; });
      return json(res, 200, {
        ok: true,
        order_ref: orderRef,
        amount_satang: amountSatang,
        emailed: out.emailed,
        email_error: out.error || null,
        download_link: link
      });
    }

    if (action === 'mark-paid') {
      const ref = clean(body.order_ref, 30);
      const note = clean(body.note, 300);
      if (!ORDER_REF_RE.test(ref)) return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });

      const sel = await db.select('orders',
        'order_ref=eq.' + encodeURIComponent(ref) + '&select=id,status,payment_method&limit=1');
      const order = Array.isArray(sel.body) && sel.body[0];
      if (!order) return json(res, 404, { ok: false, error: 'ไม่พบคำสั่งซื้อ' });

      console.log('[vinko][admin] mark-paid', ref, 'note:', note || '(ไม่มี)');

      if (order.status === 'paid') {
        const out = await deliver(ref, {});
        const link = await downloadLinkFor(ref).catch(function () { return null; });
        return json(res, 200, { ok: true, already: true, order_ref: ref, emailed: out.emailed, download_link: link });
      }
      if (order.status !== 'pending') {
        return json(res, 400, { ok: false, error: 'สถานะออเดอร์ไม่ใช่ pending (ตอนนี้เป็น ' + order.status + ')' });
      }

      const now = new Date().toISOString();
      const patch = { status: 'paid', paid_at: now };
      if (!order.payment_method) patch.payment_method = 'promptpay';
      const upd = await db.update('orders', 'id=eq.' + order.id + '&status=eq.pending', patch);
      if (!upd.ok || !(Array.isArray(upd.body) && upd.body.length)) {
        return json(res, 500, { ok: false, error: 'อัปเดตสถานะไม่สำเร็จ (อาจมีคนอื่นอัปเดตไปพร้อมกัน)' });
      }

      const out = await deliver(ref, { force: true });
      const link = await downloadLinkFor(ref).catch(function () { return null; });
      return json(res, 200, {
        ok: true, order_ref: ref, emailed: out.emailed, email_error: out.error || null, download_link: link
      });
    }

    return json(res, 400, { ok: false, error: 'ไม่รู้จัก action นี้' });
  } catch (e) {
    console.error('[vinko][admin]', action, e.message);
    return json(res, 500, { ok: false, error: 'ทำรายการไม่สำเร็จ' });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
