/* ============================================================
   GET /api/public-config

   repo นี้เป็น static site ไม่มีขั้นตอน build จึงฝัง env var
   ลงไฟล์ฝั่ง client ตอน deploy ไม่ได้ endpoint นี้จึงส่งเฉพาะ
   ค่าที่ "เปิดเผยได้" ให้หน้าเว็บไปใช้

   ส่งออกได้เฉพาะค่าที่เห็นแล้วไม่เสียหาย:
     - OMISE_PUBLIC_KEY (pkey_) ออกแบบมาให้อยู่ในหน้าเว็บอยู่แล้ว
     - สถานะราคาเปิดตัว ซึ่งตัดสินฝั่ง server เป็นตัวจริง

   ห้ามเพิ่ม secret key, service_role หรือค่าอื่นใดลงใน response นี้
   ============================================================ */

'use strict';

const catalog = require('./_lib/catalog');
const { json } = require('./_lib/util');
const config = require('./_lib/config');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false });

  const key = config.omisePublicKey();

  // กันพลาดแบบหยาบๆ: ถ้ามีคนเผลอเอา secret key มาใส่ช่อง public key
  // ห้ามส่งออกไปเด็ดขาด
  if (key && !/^pkey_/.test(key)) {
    console.error('[vinko] OMISE_PUBLIC_KEY ไม่ได้ขึ้นต้นด้วย pkey_ — ปฏิเสธการส่งออก');
    return json(res, 500, { ok: false, error: 'ระบบชำระเงินตั้งค่าไม่ถูกต้อง' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
  return json(res, 200, {
    ok: true,
    omise_public_key: key,
    launch_price_active: catalog.isLaunchPriceActive(),
    prices_satang: {
      LAB:    catalog.priceSatang('LAB'),
      BUNDLE: catalog.priceSatang('BUNDLE')
    }
  });
};
