/* ============================================================
   GET /api/health?token=<HEALTH_TOKEN>

   หน้าที่เดียว: ตอบคำถาม "deploy รอบนี้พร้อมขายจริงหรือยัง"
   ให้ได้ภายในการเปิดลิงก์ครั้งเดียว โดยไม่ต้องกดซื้อทดสอบ

   สิ่งที่ห้ามอยู่ใน response นี้เด็ดขาด:
     - ค่า key ใดๆ แม้แต่บางส่วนที่เอาไปใช้ต่อได้
     - ข้อมูลลูกค้า ชื่อ อีเมล เลขออเดอร์
   ที่ยอมให้ออกได้คือ "มีกี่ออเดอร์" ซึ่งเป็นตัวเลขเดียวที่พิสูจน์ว่า
   key อ่านตารางได้จริง ไม่ใช่แค่รูปแบบถูก

   ถ้าไม่ตั้ง HEALTH_TOKEN ไว้ endpoint นี้จะปิดตัวเองและตอบ 404
   เหมือนไม่เคยมีอยู่ — จะได้ไม่กลายเป็นช่องให้คนนอกสำรวจระบบ
   ============================================================ */

'use strict';

const config = require('./_lib/config');
const db     = require('./_lib/supabase');
const { safeEqual } = require('./_lib/util');

/** ตอบเหมือนไม่มีไฟล์นี้อยู่จริง ใช้ทั้งกรณีไม่ได้ตั้ง token และกรณี token ผิด */
function notFound(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).send(JSON.stringify({ ok: false, error: 'Not found' }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);

  const expected = config.healthToken();
  if (!expected) return notFound(res);

  const url = new URL(req.url, 'https://placeholder.local');
  const given = url.searchParams.get('token') || '';
  if (!given || !safeEqual(given, expected)) return notFound(res);

  /* ---------- 1. รูปแบบของ config ---------- */
  const cfg = config.status();

  /* ---------- 2. key ใช้ได้จริงไหม ---------- */
  // ถ้ารูปแบบผิดตั้งแต่แรก อย่าเพิ่งยิงจริง — ผลลัพธ์จะสับสนโดยไม่จำเป็น
  let supabase = { ok: false, skipped: 'config ผิดรูปแบบ ยังไม่ได้ทดสอบการเชื่อมต่อ' };
  if (!cfg.errors.length && !cfg.missing.includes('SUPABASE_URL') &&
      !cfg.missing.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    supabase = await db.ping();
    if (!supabase.ok && supabase.status === 401) {
      supabase.hint = 'Supabase ปฏิเสธ key — ถ้าเพิ่งเปลี่ยนค่าบน Vercel ต้อง Redeploy ก่อนถึงจะมีผล';
    }
  }

  /* ---------- 3. โหมดของ Omise ---------- */
  let omiseMode = 'unknown';
  try { omiseMode = config.omiseKeyMode(); } catch (e) { /* config ผิด อ่านไม่ได้ก็ปล่อยเป็น unknown */ }

  /* ---------- 4. สรุป ---------- */
  const ready = cfg.errors.length === 0 && cfg.missing.length === 0 && supabase.ok === true;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(ready ? 200 : 503).send(JSON.stringify({
    ok: ready,
    checked_at: new Date().toISOString(),

    config: {
      ok: cfg.errors.length === 0,
      errors: cfg.errors,           // ข้อความอธิบายเท่านั้น ค่าจริงถูก mask แล้วที่ config.js
      warnings: cfg.warnings,
      missing: cfg.missing,
      supabase_key_kind: cfg.supabaseKeyKind   // secret / legacy / unknown
    },

    supabase: supabase,

    omise_key_mode: omiseMode,      // test / live / unknown

    // เตือนกรณีที่พลาดง่ายที่สุดสองแบบ: ลืมสลับเป็น live หรือเผลอเปิดขายด้วย test key
    notes: [
      omiseMode === 'test' ? 'ยังใช้ Omise test key อยู่ — เงินจริงจะยังไม่เข้า' : null,
      cfg.supabaseKeyKind === 'legacy' ? 'ยังใช้ Supabase key แบบเดิม ควรย้ายไป sb_secret_' : null,
      cfg.missing.length ? 'ยังตั้ง env ไม่ครบ ' + cfg.missing.length + ' ตัว' : null
    ].filter(Boolean)
  }, null, 2));
};
