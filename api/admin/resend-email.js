/* ============================================================
   POST /api/admin/resend-email   { order_ref }
   header: x-vinko-admin: <ADMIN_SECRET>

   ไว้กดส่งอีเมลซ้ำเองเมื่อลูกค้าบอกว่าไม่ได้รับ
   ลูกค้าจ่ายเงินแล้ว ต้องมีทางแก้ให้เสมอ ไม่ใช่ปล่อยค้าง
   ============================================================ */
'use strict';

const { deliver } = require('../deliver-order');
const { json, safeEqual } = require('../_lib/util');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });

  const secret = process.env.ADMIN_SECRET;
  const given = req.headers['x-vinko-admin'];
  if (!secret || secret.length < 16 || !given || !safeEqual(given, secret)) {
    return json(res, 401, { ok: false, error: 'ไม่ได้รับอนุญาต' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const ref = body && typeof body.order_ref === 'string' ? body.order_ref.trim() : '';
  if (!/^VK-\d{4}-\d{4,6}$/.test(ref)) {
    return json(res, 400, { ok: false, error: 'order_ref ไม่ถูกต้อง' });
  }

  try {
    // force = ออก token ใหม่และส่งอีเมลซ้ำเสมอ แม้เคยส่งไปแล้ว
    const out = await deliver(ref, { force: true });
    return json(res, out.ok ? 200 : 400, out);
  } catch (e) {
    console.error('[vinko][admin] resend', ref, e.message);
    return json(res, 500, { ok: false, error: 'ส่งซ้ำไม่สำเร็จ' });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
