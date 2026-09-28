/* ============================================================
   attribution snapshot ของออเดอร์ (pure — ไม่มี I/O)

   รับ window.VINKO.attribution() ที่ client ส่งมา แล้วคัดให้เหลือเฉพาะ
   field ที่อนุญาต ก่อนบันทึกลง orders.attribution_snapshot (migration 008)

   กติกา:
   - ข้อมูลจาก client เชื่อไม่ได้ — whitelist ทุก key, ตัดความยาว, ทิ้งที่เหลือ
   - ฟังก์ชันนี้ห้าม throw เด็ดขาด เพราะอยู่ในเส้นทางสร้างออเดอร์
     attribution ห้ามมีผลกับราคา การตรวจ input หรือการที่ checkout จะไปต่อได้
   - consent ต้องเป็น true จริงๆ เท่านั้นถึงจะเก็บ
     false = no_consent, ค่าอื่น (ไม่ส่งมา / client เก่า) = none
   ============================================================ */

'use strict';

const SCHEMA_VERSION = 1;
const MAX_LEN = 100;
const MAX_CLICK_ID_LEN = 255;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const TEXT_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'activation_id'];
const CLICK_PLATFORMS = ['meta', 'google', 'tiktok'];

// ISO 8601 แบบที่ Date#toISOString ผลิต (ยอม offset แทน Z ได้)
// ไม่ใช้ Date.parse เพียวๆ เพราะมันรับรูปแบบอื่นอย่าง "Sep 28 2026" ด้วย
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/* ตัด control char + surrogate ที่ไม่มีคู่ แล้วตัดความยาวตาม code point
   สำคัญ: Postgres jsonb ปฏิเสธ \u0000 และ surrogate เดี่ยว
   ถ้าหลุดไปถึง insert ได้ ออเดอร์จะบันทึกไม่ได้ทั้งแถว */
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim();
  return Array.from(s).slice(0, max).join('').trim();
}

function cleanTime(v, nowMs) {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms > nowMs + FUTURE_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

/* touch เดียว (first หรือ last) — คืน null ถ้าไม่มีอะไรที่นับเป็น hit ได้
   t อย่างเดียวไม่นับ ต้องมี utm_* / activation_id / click id อย่างน้อยหนึ่งตัว */
function cleanTouch(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};

  for (const k of TEXT_KEYS) {
    const v = cleanText(raw[k], MAX_LEN);
    if (v) out[k] = v;
  }

  // platform กับ value ต้องมาเป็นคู่ — value ที่ไม่รู้ว่ามาจากแพลตฟอร์มไหนใช้ไม่ได้
  const platform = cleanText(raw.click_id_platform, MAX_LEN).toLowerCase();
  const clickId = cleanText(raw.click_id_value, MAX_CLICK_ID_LEN);
  if (CLICK_PLATFORMS.includes(platform) && clickId) {
    out.click_id_platform = platform;
    out.click_id_value = clickId;
  }

  if (!Object.keys(out).length) return null;

  const t = cleanTime(raw.t, nowMs);
  if (t) out.t = t;
  return out;
}

/**
 * @param {*} rawAttribution  สิ่งที่ client ส่งมาใน body.attribution
 * @param {*} consentFlag     body.attribution_consent
 * @param {string} nowIso     เวลาฝั่ง server
 * @returns {{snapshot: object|null, status: 'captured'|'none'|'no_consent'}}
 */
function buildSnapshot(rawAttribution, consentFlag, nowIso) {
  try {
    if (consentFlag === false) return { snapshot: null, status: 'no_consent' };
    if (consentFlag !== true) return { snapshot: null, status: 'none' };

    const nowMs = typeof nowIso === 'string' && ISO_RE.test(nowIso) ? Date.parse(nowIso) : NaN;
    if (!Number.isFinite(nowMs)) return { snapshot: null, status: 'none' };

    if (!rawAttribution || typeof rawAttribution !== 'object' || Array.isArray(rawAttribution)) {
      return { snapshot: null, status: 'none' };
    }

    const first = cleanTouch(rawAttribution.first, nowMs);
    const last = cleanTouch(rawAttribution.last, nowMs);
    if (!first && !last) return { snapshot: null, status: 'none' };

    return {
      snapshot: {
        first: first,
        last: last,
        captured_at: new Date(nowMs).toISOString(),
        schema_version: SCHEMA_VERSION
      },
      status: 'captured'
    };
  } catch (e) {
    return { snapshot: null, status: 'none' };
  }
}

module.exports = { buildSnapshot, SCHEMA_VERSION };
