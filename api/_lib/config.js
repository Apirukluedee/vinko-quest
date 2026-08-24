/* ============================================================
   จุดเดียวของทั้ง /api ที่อ่านค่า environment variable

   หน้าที่ของไฟล์นี้มีอย่างเดียว: ทำให้ "ค่าที่ตั้งผิด" ดังทันที
   แทนที่จะเงียบแล้วไปพังตอนลูกค้ากดจ่ายเงิน

   แบ่งความผิดเป็น 2 ระดับ เพราะสองอย่างนี้ควรจัดการคนละแบบ:

     1. ค่าผิดรูปแบบ (ใส่ anon key แทน secret, ใส่ pkey สลับกับ skey,
        ใส่ URL ของหน้า dashboard) -> throw ทันทีตอนโหลด module
        รวมทุกข้อไว้ในข้อความเดียว จะได้แก้รอบเดียวจบ

     2. ค่าที่ยังไม่ได้ตั้ง -> ไม่ throw ตอนโหลด แต่ throw ตอนมีคนเรียกใช้จริง
        เหตุผล: ถ้า throw ตอนโหลดด้วย เวลา deploy แล้วตั้ง env ไม่ครบ
        ทุก endpoint จะตายพร้อมกันรวมทั้ง /api/health ซึ่งเป็นตัวเดียว
        ที่ควรจะยังตอบได้เพื่อบอกว่าขาดอะไร

   ห้าม log ค่าจริงของ key ไม่ว่ากรณีใด ใช้ mask() เท่านั้น
   ============================================================ */

'use strict';

/** ย่อค่าให้พอระบุได้ว่าใส่อะไรไป แต่เอาไปใช้ต่อไม่ได้ */
function mask(v) {
  if (typeof v !== 'string' || !v) return '(ว่าง)';
  return v.slice(0, 8) + '… (ยาว ' + v.length + ' ตัว)';
}

/** ถอด payload ของ JWT (base64url) โดยไม่ตรวจลายเซ็น — ใช้อ่าน claim เท่านั้น */
function decodeJwtPayload(token) {
  const part = String(token).split('.')[1];
  if (!part) return null;
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

/* ============================================================
   ตัวตรวจ — เขียนเป็นฟังก์ชันบริสุทธิ์ที่รับ env เข้ามา
   เพื่อให้ tests เรียกซ้ำด้วยค่าปลอมได้โดยไม่ต้องรีโหลด module
   ============================================================ */

/**
 * @returns {{errors: string[], warnings: string[], missing: string[], supabaseKeyKind: string|null}}
 */
function validate(env) {
  const errors = [];
  const warnings = [];
  const missing = [];
  let supabaseKeyKind = null;

  const has = n => typeof env[n] === 'string' && env[n].trim() !== '';
  const need = n => { if (!has(n)) missing.push(n); };

  /* ---------------- SUPABASE_URL ---------------- */
  need('SUPABASE_URL');
  if (has('SUPABASE_URL')) {
    const raw = env.SUPABASE_URL.trim();

    if (/\/rest\/v1/.test(raw)) {
      errors.push('SUPABASE_URL: ตัด /rest/v1/ ออก ใส่แค่ URL ฐานของโปรเจกต์ ' +
                  'เช่น https://xxxx.supabase.co (โค้ดต่อ /rest/v1 ให้เองอยู่แล้ว)');
    } else if (/dashboard|\/project\/|\/org\//.test(raw)) {
      errors.push('SUPABASE_URL: นี่คือ URL ของหน้า dashboard ไม่ใช่ Project URL ' +
                  'หาได้ที่ Settings -> API -> Project URL');
    } else if (/^https:\/\/db\./.test(raw)) {
      errors.push('SUPABASE_URL: นี่คือ host ของฐานข้อมูล (db.xxxx.supabase.co) ไม่ใช่ API URL ' +
                  'ใช้ Project URL แทน');
    } else if (!/^https:\/\//.test(raw)) {
      errors.push('SUPABASE_URL: ต้องขึ้นต้นด้วย https:// (ได้มา: ' + mask(raw) + ')');
    } else if (/\/$/.test(raw)) {
      errors.push('SUPABASE_URL: ห้ามมี / ปิดท้าย ตัดออกให้เหลือ https://xxxx.supabase.co');
    } else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(raw)) {
      errors.push('SUPABASE_URL: รูปแบบไม่ถูกต้อง ต้องเป็น https://<ref>.supabase.co ' +
                  'ไม่มี path ต่อท้าย (ได้มา: ' + mask(raw) + ')');
    }
  }

  /* ---------------- SUPABASE_SERVICE_ROLE_KEY ---------------- */
  need('SUPABASE_SERVICE_ROLE_KEY');
  if (has('SUPABASE_SERVICE_ROLE_KEY')) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();

    if (key.startsWith('sb_publishable_')) {
      errors.push('SUPABASE_SERVICE_ROLE_KEY: นี่คือ publishable key ที่ใช้ฝั่ง client ' +
                  'ต้องใช้ secret key (sb_secret_) แทน — ' +
                  'หาได้ที่ Settings -> API Keys -> แท็บ API Keys -> ส่วน Secret keys');
    } else if (key.startsWith('sb_secret_')) {
      supabaseKeyKind = 'secret';
    } else if (key.startsWith('eyJ')) {
      const payload = decodeJwtPayload(key);
      if (!payload) {
        errors.push('SUPABASE_SERVICE_ROLE_KEY: หน้าตาเป็น JWT แต่ถอด payload ไม่ออก ' +
                    'อาจคัดลอกมาไม่ครบ (ได้มา: ' + mask(key) + ')');
      } else if (payload.role === 'anon') {
        errors.push('SUPABASE_SERVICE_ROLE_KEY: นี่คือ anon key ไม่ใช่ service_role — ' +
                    'ระบบจะอ่านข้อมูลไม่ได้เพราะติด Row Level Security');
      } else if (payload.role !== 'service_role') {
        errors.push('SUPABASE_SERVICE_ROLE_KEY: JWT นี้มี role = ' +
                    JSON.stringify(payload.role) + ' ซึ่งไม่ใช่ service_role');
      } else if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
        errors.push('SUPABASE_SERVICE_ROLE_KEY: key หมดอายุแล้วเมื่อ ' +
                    new Date(payload.exp * 1000).toISOString() + ' ต้องออกใบใหม่');
      } else {
        supabaseKeyKind = 'legacy';
        warnings.push('SUPABASE_SERVICE_ROLE_KEY: กำลังใช้ key แบบเดิม (service_role JWT) ' +
                      'ซึ่ง Supabase จะเลิกรองรับภายในสิ้นปี 2026 ควรย้ายไป sb_secret_ ก่อนเปิดขายจริง');
      }
    } else {
      supabaseKeyKind = 'unknown';
      warnings.push('SUPABASE_SERVICE_ROLE_KEY: รูปแบบไม่คุ้นเคย (' + mask(key) + ') ' +
                    'ส่งไปให้ Supabase ตัดสินเอง');
    }
  }

  /* ---------------- Omise ---------------- */
  need('OMISE_SECRET_KEY');
  if (has('OMISE_SECRET_KEY')) {
    const k = env.OMISE_SECRET_KEY.trim();
    if (k.startsWith('pkey_')) {
      errors.push('OMISE_SECRET_KEY: ใส่สลับกับ public key — ช่องนี้ต้องเป็น skey_ ' +
                  '(ตรวจด้วยว่า OMISE_PUBLIC_KEY ไม่ได้ถูกใส่เป็น skey_ ไปด้วย)');
    } else if (!k.startsWith('skey_')) {
      errors.push('OMISE_SECRET_KEY: ต้องขึ้นต้นด้วย skey_ (ได้มา: ' + mask(k) + ')');
    }
  }

  need('OMISE_PUBLIC_KEY');
  if (has('OMISE_PUBLIC_KEY')) {
    const k = env.OMISE_PUBLIC_KEY.trim();
    if (k.startsWith('skey_')) {
      // ร้ายแรงกว่าอีกทางหนึ่ง เพราะ /api/public-config ส่งค่านี้ออกไปให้ browser
      errors.push('OMISE_PUBLIC_KEY: ใส่สลับกับ secret key — ค่านี้ถูกส่งออกไปให้เบราว์เซอร์ ' +
                  'ถ้า deploy ทั้งแบบนี้เท่ากับ secret key หลุดสู่สาธารณะ ให้ revoke key นั้นทันที');
    } else if (!k.startsWith('pkey_')) {
      errors.push('OMISE_PUBLIC_KEY: ต้องขึ้นต้นด้วย pkey_ (ได้มา: ' + mask(k) + ')');
    }
  }

  /* ---------------- Resend (ไม่บังคับจนกว่าจะส่งอีเมลจริง) ---------------- */
  if (has('RESEND_API_KEY') && !env.RESEND_API_KEY.trim().startsWith('re_')) {
    errors.push('RESEND_API_KEY: ต้องขึ้นต้นด้วย re_ (ได้มา: ' + mask(env.RESEND_API_KEY) + ')');
  }

  /* ---------------- APP_BASE_URL ---------------- */
  need('APP_BASE_URL');
  if (has('APP_BASE_URL')) {
    const u = env.APP_BASE_URL.trim();
    if (!/^https:\/\//.test(u)) {
      errors.push('APP_BASE_URL: ต้องขึ้นต้นด้วย https:// (ได้มา: ' + mask(u) + ')');
    } else if (/\/$/.test(u)) {
      errors.push('APP_BASE_URL: ห้ามมี / ปิดท้าย — ลิงก์ในอีเมลจะกลายเป็น // แล้วกดไม่ติด');
    }
  }

  /* ---------------- ค่าตั้งเวลา/วันที่ ---------------- */
  if (has('LAUNCH_PROMO_END') && Number.isNaN(new Date(env.LAUNCH_PROMO_END.trim()).getTime())) {
    errors.push('LAUNCH_PROMO_END: อ่านเป็นวันที่ไม่ได้ ' +
                'ต้องเป็นรูปแบบ 2026-09-30T23:59:59+07:00 — ' +
                'ค่าที่อ่านไม่ออกจะถูกมองว่า "ยังอยู่ในช่วงราคาเปิดตัว" ตลอดไปโดยไม่มีใครรู้');
  }

  if (has('STORY_DELIVERY_DATES')) {
    const bad = env.STORY_DELIVERY_DATES.split(',')
      .map(s => s.trim()).filter(Boolean)
      .filter(s => !/^\d{4}-\d{2}-\d{2}$/.test(s));
    if (bad.length) {
      errors.push('STORY_DELIVERY_DATES: มีค่าที่ไม่ใช่รูปแบบ YYYY-MM-DD จำนวน ' + bad.length + ' ค่า — ' +
                  'ค่าที่ผิดจะถูกทิ้งเงียบๆ ทำให้นิทานบางเรื่องไม่มีกำหนดส่ง');
    }
  }

  /* ---------------- ความลับภายใน ---------------- */
  if (has('ADMIN_SECRET') && env.ADMIN_SECRET.trim().length < 16) {
    errors.push('ADMIN_SECRET: สั้นเกินไป (' + env.ADMIN_SECRET.trim().length + ' ตัว) ต้องอย่างน้อย 16 ตัว');
  }

  if (!has('IP_HASH_SALT')) {
    warnings.push('IP_HASH_SALT: ยังไม่ได้ตั้ง ระบบจะใช้ salt ค่าเริ่มต้นที่อยู่ในโค้ด ' +
                  'ซึ่งทำให้ hash IP ย้อนกลับได้ง่าย ตั้งเป็นค่าสุ่มยาวๆ แล้วอย่าเปลี่ยนอีก');
  }

  /* ---------------- แจ้งเตือน LINE (ตั้งครึ่งเดียว = ไม่ทำงานเงียบๆ ไม่ error) ---------------- */
  if (has('LINE_CHANNEL_ACCESS_TOKEN') !== has('LINE_ADMIN_USER_ID')) {
    warnings.push('ตั้ง LINE_CHANNEL_ACCESS_TOKEN กับ LINE_ADMIN_USER_ID ไว้แค่ตัวเดียว ' +
                  'ต้องมีทั้งคู่ถึงจะแจ้งเตือนออเดอร์ทาง LINE ได้ ตอนนี้จะไม่ส่งอะไรเลย');
  }

  return { errors, warnings, missing, supabaseKeyKind };
}

/* ============================================================
   ตรวจตอนโหลด module

   ตั้งใจ "ตรวจตอนโหลด แต่ throw ตอนอ่านค่า" ไม่ใช่ throw ตอนโหลดเลย
   เหตุผลข้อเดียว: ถ้า throw ตอนโหลด /api/health จะตายไปด้วย
   แล้วจะไม่เหลืออะไรให้เปิดดูหลัง deploy ว่าผิดตรงไหน
   ซึ่งย้อนแย้งกับเหตุผลที่สร้าง /api/health ขึ้นมาตั้งแต่แรก

   ผลลัพธ์ยังเหมือนเดิมทุกประการสำหรับ endpoint อื่น:
   แตะค่า env ตัวไหนก็ตาม = ได้ error รวมทุกข้อทันที ไม่มีทางทำงานต่อแบบเงียบๆ
   ============================================================ */

const RESULT = validate(process.env);

for (const w of RESULT.warnings) console.warn('[vinko] ' + w);

if (RESULT.errors.length) {
  // ให้โผล่ใน log ตั้งแต่ cold start แรก ไม่ต้องรอให้มีคนยิง request เข้ามา
  console.error('[vinko] ' + configErrorMessage());
}

function configErrorMessage() {
  return 'ตั้งค่า environment ผิด ' + RESULT.errors.length + ' ข้อ แก้ให้ครบแล้ว deploy ใหม่:\n' +
         RESULT.errors.map((e, i) => '  ' + (i + 1) + ') ' + e).join('\n');
}

/** เรียกก่อนอ่านค่า env ทุกครั้ง — config ที่ผิดรูปแบบต้องไม่มีทางถูกใช้งาน */
function assertValid() {
  if (RESULT.errors.length) throw new Error(configErrorMessage());
}

/* ============================================================
   ตัวอ่านค่า — ขาดแล้วดังตอนเรียกใช้
   ============================================================ */

function req(name) {
  assertValid();
  const v = process.env[name];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error('ENV_MISSING: ' + name +
                    ' — ตั้งค่าบน Vercel -> Settings -> Environment Variables แล้ว Redeploy');
  }
  return v.trim();
}

function opt(name, fallback) {
  assertValid();
  const v = process.env[name];
  return (typeof v === 'string' && v.trim() !== '') ? v.trim() : fallback;
}

/**
 * ให้แต่ละ endpoint ประกาศเองว่าต้องใช้ env ตัวไหนบ้าง แล้วล้มตั้งแต่บรรทัดแรก
 * ถ้าขาด — ดีกว่าไปตายกลางทางตอนที่สร้างออเดอร์ไปครึ่งหนึ่งแล้ว
 */
function requireEnv(names) {
  const missing = names.filter(n => {
    const v = process.env[n];
    return typeof v !== 'string' || v.trim() === '';
  });
  if (missing.length) throw new Error('ENV_MISSING: ' + missing.join(', '));
}

/** test / live / unknown — ใช้กันเผลอ deploy โดยที่ยังเป็น test key */
function omiseKeyMode() {
  const k = opt('OMISE_SECRET_KEY', '');
  if (k.startsWith('skey_test_')) return 'test';
  if (k.startsWith('skey_live_')) return 'live';
  return 'unknown';
}

module.exports = {
  /* --- Supabase --- */
  supabaseUrl:        () => req('SUPABASE_URL').replace(/\/+$/, ''),
  supabaseKey:        () => req('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseKeyKind:    () => validate(process.env).supabaseKeyKind,

  /* --- Omise --- */
  omiseSecretKey:     () => req('OMISE_SECRET_KEY'),
  omisePublicKey:     () => opt('OMISE_PUBLIC_KEY', ''),
  omiseKeyMode,

  /* --- อีเมล --- */
  resendApiKey:       () => opt('RESEND_API_KEY', ''),

  /* --- ทั่วไป ---
     appBaseUrl คืน '' เมื่อยังไม่ได้ตั้ง ไม่ใส่ค่า default ให้
     เพราะ webhook ใช้ค่าว่างเป็นสัญญาณว่า "ยังตั้งไม่ครบ อย่าเพิ่งยิงต่อ"
     ถ้าแอบใส่ default ให้ ระบบจะยิงไปโดเมนที่ยังไม่ได้ย้าย DNS แบบเงียบๆ */
  appBaseUrl:         () => opt('APP_BASE_URL', '').replace(/\/+$/, ''),
  launchPromoEnd:     () => opt('LAUNCH_PROMO_END', ''),
  storyDeliveryDates: () => opt('STORY_DELIVERY_DATES', ''),
  ipHashSalt:         () => opt('IP_HASH_SALT', 'vinko-default-salt'),

  /* --- ข้อมูลผู้ขายท้ายอีเมล --- */
  sellerName:         () => opt('SELLER_NAME', 'VINKO WOW LAB'),
  contactEmail:       () => opt('CONTACT_EMAIL', ''),
  lineUrl:            () => opt('LINE_URL', 'https://lin.ee/8F08BYJ'),

  /* --- ความลับภายใน ---
     ทั้งสี่ตัวคืน '' เมื่อยังไม่ได้ตั้ง ไม่ throw โดยตั้งใจ
     เพราะ endpoint ที่ใช้ค่าพวกนี้ต้องตอบ 401 เมื่อไม่มีความลับ
     ถ้า throw จะกลายเป็น 500 ซึ่งบอกคนนอกมากเกินจำเป็น
     และ "ไม่ได้ตั้งความลับ" ต้องไม่มีทางแปลว่า "ผ่านได้" เด็ดขาด */
  internalTaskSecret: () => opt('INTERNAL_TASK_SECRET', ''),
  adminSecret:        () => opt('ADMIN_SECRET', ''),
  cronSecret:         () => opt('CRON_SECRET', ''),

  /* --- แจ้งเตือนออเดอร์ทาง LINE (ไม่บังคับ — ไม่ตั้งก็แค่ไม่มีแจ้งเตือน) --- */
  lineChannelToken:   () => opt('LINE_CHANNEL_ACCESS_TOKEN', ''),
  lineAdminUserId:    () => opt('LINE_ADMIN_USER_ID', ''),

  /* HEALTH_TOKEN เป็นตัวเดียวที่อ่านได้โดยไม่ต้องผ่าน assertValid()
     เพราะ /api/health ต้องตรวจสิทธิ์ให้ได้แม้ตอนที่ config ตัวอื่นผิด
     ไม่งั้นหน้าที่ใช้วินิจฉัยจะใช้ไม่ได้พอดีตอนที่ต้องใช้มันที่สุด */
  healthToken:        () => String(process.env.HEALTH_TOKEN || '').trim(),

  /* --- ให้ endpoint ประกาศ env ที่ตัวเองต้องใช้ --- */
  requireEnv,

  /* --- สำหรับ /api/health และ tests --- */
  validate,
  mask,
  status:             () => validate(process.env)
};
