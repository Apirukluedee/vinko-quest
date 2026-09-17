/* ============================================================
   ตารางปลายทางของ QR — static map

   หัวใจ: ตารางนี้อยู่ในโค้ด ไม่ได้อยู่ในฐานข้อมูล
   /r/:token จึงทำงานได้แม้ Supabase หลับ (free plan pause เองเมื่อไม่ใช้ 7 วัน)
   ถ้าเก็บปลายทางไว้ใน DB เวลา DB ล่มจะ "ไม่รู้ว่าจะส่งคนไปไหน" ด้วย

   ย้าย X-stand ไปงานใหม่ = เพิ่มรอบใหม่ในไฟล์นี้แล้ว deploy
   ไม่ต้องพิมพ์ QR ใหม่ ไม่ต้องทำ X-stand ใหม่
   ห้ามลบรอบเก่าทิ้ง ให้ตั้ง active:false แทน จะได้ตามประวัติย้อนหลังได้

   ------------------------------------------------------------
   confirmed: ประตูสุดท้ายก่อน QR ใช้งานได้จริง

   QR ที่พิมพ์ลงกระดาษแล้วแก้ไม่ได้ ถ้าจับคู่ token กับปลายทางผิด
   คนหน้างานจะไปผิดหน้าและเรารู้ตัวอีกทีตอนงานจบไปแล้ว
   จึงต้องมีคนยืนยันว่า "ป้ายกำกับบน X-stand ตรงกับปลายทางนี้จริง"
   ก่อนเท่านั้น รายการที่ confirmed:false จะตอบ 404 ไม่ redirect

   สถานะตอนนี้: ยังไม่มีสเปก X-stand ในรีโพเลย (ค้นทั้ง content/ แล้ว
   มีแต่ line-rich-menu.md ซึ่งเป็นเมนูในแอป LINE ไม่ใช่ป้ายหน้างาน)
   จึงยังจับคู่ปลายทางไม่ได้ ต้องรอป้ายจริงจากเจ้าของงาน
   ------------------------------------------------------------

   activation_id: QR_ID__EVENT_CODE__rNN
     QR-XS-A-LINE-01   ใบไหน
     T21KORAT-2026-09  งานไหน
     r01               รอบที่เท่าไรของงานนั้น

   หมายเหตุ: activation_id ส่งเป็น parameter ของเราเอง ไม่ใช่ utm_id
   เพราะ Google นิยาม utm_id ว่าเป็นรหัส "แคมเปญ" ส่วน activation คือ
   รอบการใช้งานของ QR หนึ่งใบ คนละความหมายกัน ถ้ายัดใส่ utm_id
   รายงาน Campaign ใน GA4 จะแตกเป็นรายใบ QR แทนที่จะรวมเป็นงานเดียว
   ============================================================ */

'use strict';

/* ปลายทางที่อนุญาต — path ภายในเว็บเราเท่านั้น
   ห้ามมี http:// หรือ // นำหน้า และห้ามรับค่าจาก query string เด็ดขาด */
const ALLOWED_DEST = ['/free-sample', '/ef-check', '/checkout', '/', '/books'];

const ACTIVATION_RE = /^[A-Z0-9-]+__[A-Z0-9-]+__r\d{2}$/;
const TOKEN_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

const MAP = {
  /* ------------------------------------------------------------------
     ปลายทางมาจากเอกสารที่อนุมัติแล้ว ไม่ได้เดาเอง:

       02_VINKO_MARKETING_CHANNELS.md บรรทัด 140-142
         "ถ้ามี 2 QR: Website = ดูสินค้า / LINE = รับ Free Resource"

       03_VINKO_MARKETING_TRACKING_UTM.md ข้อ 6
         Website QR -> ดูสินค้า / รายละเอียด / ดาวน์โหลด / sample / ซื้อ
         LINE QR    -> รับ free sample / EF check-in / printable
         "ถ้าระบบรองรับ ควรใช้ trackable route ก่อน redirect เข้า LINE
          เพื่อเก็บ source attribution"  <- ตรงกับ /r/ ที่ทำอยู่นี้

     แต่ยัง confirmed:false ทั้งคู่ เพราะเอกสารบอก "บทบาท" ของ QR
     ไม่ได้บอกว่า QR ที่พิมพ์ลงกระดาษไปแล้วฝัง URL อะไรไว้จริงๆ

     สร้าง /r/ ขึ้นมาใหม่ไม่ได้เปลี่ยน QR ที่พิมพ์ไปแล้วโดยอัตโนมัติ
     ถ้าใบเดิมฝัง https://vinko.quest/free-sample ตรงๆ หรือฝังลิงก์ LINE ตรงๆ
     การตั้ง confirmed:true ที่นี่จะไม่มีผลกับใบนั้นเลย

     ต้องได้ 2 อย่างนี้ก่อนถึงจะเปิดใช้ได้:
       1. ไฟล์อาร์ตเวิร์ก X-stand จริง (ดูป้ายกำกับใต้ QR แต่ละใบ)
       2. สแกน QR จากไฟล์ final หรือ print proof แล้วอ่าน URL ที่ฝังอยู่
          ตามข้อ 7 QR QA Checklist ของเอกสาร tracking
     ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------
     ตารางออกบูธ (16 ก.ย. 2026): ดึงจาก Google Calendar ตารางออกบูธ
     (calendar เดียวกับที่ Sky House ใช้ — พี่คุมทุกแบรนด์ในปฏิทินเดียวกัน)
     ผ่าน scripts/list-booth-calendar-events.js แล้วให้เจ้าของงานเลือกว่า
     event ไหนเป็นของ VINKO (ทุกงานวาง X-stand เหมือนกันหมด)

     ทุก round ใช้ QR ใบเดียวกัน (QR-XS-A-WEB-02.svg, token เดิม, dest '/'
     เดิม) ที่ confirmed ไปแล้วบรรทัดบน — ต่างกันแค่ location/utm สำหรับ
     ระบุงานเพื่อดูรายงานย้อนหลัง จึงตั้ง confirmed:true ต่อได้เลยไม่ต้อง
     รอคนยืนยันใหม่ทีละงาน (ไม่มีอาร์ตเวิร์ก/ปลายทางใหม่ให้ตรวจ)

     current() จะเลือก round ที่ start_date<=วันนี้<=end_date ก่อน ถ้าวันนี้
     ไม่ตรงกับ round ไหนเลย (ช่วงว่างระหว่างงาน) จะ fallback ไปที่ round
     evergreen (start_date/end_date เป็น null) ท้ายตาราง กัน QR ที่พิมพ์ไป
     แล้ว 404 เวลาไม่มีบูธ

     หมายเหตุ: 15–25 ต.ค. 2026 มี 2 งานพร้อมกัน (Jungle Walk งามวงศ์วาน กับ
     Terminal 21 พระราม3) เพราะมี X-stand หลายชุดวางพร้อมกันคนละที่ — ทั้งคู่
     ใช้ QR ใบเดียวกัน (token เดียวกันทั้งระบบ) ช่วงที่ซ้อนกันนี้ utm_campaign
     จะได้แค่อันใดอันหนึ่ง (ตัวแรกที่เจอในตาราง) แยกไม่ได้ว่าลูกค้าสแกนจากที่ไหน
     ถ้าอยากแยกให้แม่นช่วงซ้อน ต้องพิมพ์ QR คนละใบต่อสถานที่ (คนละ token)
     ------------------------------------------------------------------ */
  'xstand-a-website': [
    {
      activation_id: 'QR-XS-A-WEB-02__T21KORAT-2026-09__r01',
      active: true,
      confirmed: true,                 // ยืนยัน 16 ก.ย. 2026: QR-XS-A-WEB-02.svg → /r/xstand-a-website → /
      location: 'เทอมินอล 21 โคราช', start_date: '2026-09-24', end_date: '2026-10-05',
      dest: '/',                       // "ดูสินค้า" — หน้าแรกคือหน้าขายของสินค้านี้
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 't21korat_sep2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Website QR X-stand v6 — เทอมินอล 21 โคราช 24 ก.ย.–5 ต.ค. 2026 (มี banner ครบ 3 ชิ้น)'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__GATEWAYBS-2026-09__r01',
      active: true,
      confirmed: true,
      location: 'Gateway บางซื่อ', start_date: '2026-09-19', end_date: '2026-09-27',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'gateway_bangsue_sep2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Gateway บางซื่อ 19–27 ก.ย. 2026'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__FURTOPIA-2026-10__r01',
      active: true,
      confirmed: true,
      location: 'FUR TOPIA เซียร์รังสิต', start_date: '2026-10-10', end_date: '2026-10-11',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'furtopia_seer_rangsit_oct2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'FUR TOPIA เซียร์รังสิต 10–11 ต.ค. 2026'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__JUNGLEWALK-2026-10__r01',
      active: true,
      confirmed: true,
      location: 'The Mall งามวงศ์วาน (Jungle Walk)', start_date: '2026-10-15', end_date: '2026-10-25',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'jungle_walk_ngamwongwan_oct2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'The Mall งามวงศ์วาน (Jungle Walk) 15–25 ต.ค. 2026 — ซ้อนกับ T21 พระราม3'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__T21RAMA3-2026-10__r01',
      active: true,
      confirmed: true,
      location: 'Terminal 21 พระราม3', start_date: '2026-10-20', end_date: '2026-11-01',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 't21rama3_oct2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Terminal 21 พระราม3 20 ต.ค.–1 พ.ย. 2026 (มี banner ครบ 3 ชิ้น) — ซ้อนกับ Jungle Walk'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__HUAHINPETPAWRADISE-2026-10__r01',
      active: true,
      confirmed: true,
      location: 'Market Village หัวหิน - Pet Pawradise', start_date: '2026-10-26', end_date: '2026-11-04',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'market_village_huahin_petpawradise_oct2026',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Market Village หัวหิน - Pet Pawradise 26 ต.ค.–4 พ.ย. 2026'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__HUAHIN-2027-01__r01',
      active: true,
      confirmed: true,
      location: 'Market Village หัวหิน', start_date: '2027-01-08', end_date: '2027-01-17',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'market_village_huahin_jan2027',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Market Village หัวหิน 8–17 ม.ค. 2027'
    },
    {
      activation_id: 'QR-XS-A-WEB-02__EVERGREEN__r01',
      active: true,
      confirmed: true,
      location: null, start_date: null, end_date: null,
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 'evergreen',
        utm_content:  'qr_xs_a_web_02'
      },
      note: 'Fallback — ใช้ตอนวันนี้ไม่ตรงกับงานไหนในตาราง (ช่วงว่างระหว่างบูธ) กัน QR ที่พิมพ์ไปแล้ว 404'
    }
  ],

  /* ------------------------------------------------------------------
     โปสเตอร์แยก 2 ใบ (16 ก.ย. 2026): STORIES / WOW LAB คนละใบ ใช้ครั้งแรกที่
     Terminal 21 พระราม3 (20 ต.ค.–1 พ.ย. 2026, มี banner ครบ 3 ชิ้นที่งานนี้)
     ทั้งคู่ปลายทางเดียวกับ X-stand คือ '/' (ยืนยันแล้ว) แต่แยก token กันเพื่อ
     เทียบได้ว่าใบไหนดึงคนสแกนมากกว่า — สแกนจากไฟล์จริงแล้วยืนยัน 17 ก.ย. 2026
     (ดูขั้นตอนใน content/qr-activation.md หัวข้อ "confirmed")
     ------------------------------------------------------------------ */
  'poster-stories': [
    {
      activation_id: 'QR-PSTR-A-01__T21RAMA3-2026-10__r01',
      active: true,
      confirmed: true,                 // ยืนยัน 17 ก.ย. 2026: สแกน QR จริงแล้วเข้า vinko.quest ถูกโดเมน
      location: 'Terminal 21 พระราม3', start_date: '2026-10-20', end_date: '2026-11-01',
      dest: '/books',                  // 17 ก.ย. 2026: เปลี่ยนจากหน้าแรก — โปสเตอร์ขายของไปแล้วในตัว พาไปหน้าสั่งซื้อตรงดีกว่า
      utm: {
        utm_source:   'offline',
        utm_medium:   'poster',
        utm_campaign: 't21rama3_oct2026',
        utm_content:  'qr_poster_stories'
      },
      note: 'โปสเตอร์ STORIES เดี่ยว — Terminal 21 พระราม3 20 ต.ค.–1 พ.ย. 2026'
    },
    {
      activation_id: 'QR-PSTR-A-01__EVERGREEN__r01',
      active: true,
      confirmed: true,                 // ยืนยัน 17 ก.ย. 2026 (QR ใบเดียวกับรอบข้างบน)
      location: null, start_date: null, end_date: null,
      dest: '/books',
      utm: {
        utm_source:   'offline',
        utm_medium:   'poster',
        utm_campaign: 'evergreen',
        utm_content:  'qr_poster_stories'
      },
      note: 'Fallback โปสเตอร์ STORIES — ช่วงว่างระหว่างงาน'
    }
  ],

  'poster-wowlab': [
    {
      activation_id: 'QR-PWL-A-01__T21RAMA3-2026-10__r01',
      active: true,
      confirmed: true,                 // ยืนยัน 17 ก.ย. 2026: สแกน QR จริงแล้วเข้า vinko.quest ถูกโดเมน
      location: 'Terminal 21 พระราม3', start_date: '2026-10-20', end_date: '2026-11-01',
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'poster',
        utm_campaign: 't21rama3_oct2026',
        utm_content:  'qr_poster_wowlab'
      },
      note: 'โปสเตอร์ WOW LAB เดี่ยว — Terminal 21 พระราม3 20 ต.ค.–1 พ.ย. 2026'
    },
    {
      activation_id: 'QR-PWL-A-01__EVERGREEN__r01',
      active: true,
      confirmed: true,                 // ยืนยัน 17 ก.ย. 2026 (QR ใบเดียวกับรอบข้างบน)
      location: null, start_date: null, end_date: null,
      dest: '/',
      utm: {
        utm_source:   'offline',
        utm_medium:   'poster',
        utm_campaign: 'evergreen',
        utm_content:  'qr_poster_wowlab'
      },
      note: 'Fallback โปสเตอร์ WOW LAB — ช่วงว่างระหว่างงาน'
    }
  ],

  /* ------------------------------------------------------------------
     ตัดสินใจแล้ว (9 ก.ย. 2026): QR ฝั่ง LINE ไม่ผ่าน /r/ อีกต่อไป

     ใช้ QR ที่ดาวน์โหลดจาก LINE OA Manager โดยตรงบน X-stand แทน เพราะ
     QR/ลิงก์ line.me/R/ti/p/... เป็นช่องทางที่ LINE เอกสารทางการระบุว่า
     ใช้เปิดหน้าโปรไฟล์และเพิ่มเพื่อนในแอป — เป็นทางสั้นและเสี่ยงน้อยสุด
     สำหรับคนหน้าบูธ ส่วน /r/ ที่ห่อ redirect อีกชั้นไม่ได้รับประกันผลแบบ
     เดียวกันในทุกกล้อง/OS (แค่ "รองรับ" ไม่ใช่ "การันตี")

     เหตุผลเรื่อง attribution ก็ไม่ได้เสียไป: ลิงก์ LINE ที่ใช้จริง
     (https://lin.ee/8F08BYJ -> OA @330lurio) มีอยู่แล้วทั่วเว็บ ถ้า/เมื่อ
     ต้องย้ายงาน/เปลี่ยนสถานที่ ก็ยังไม่ต้องพิมพ์ QR ใหม่ตราบใดที่ OA
     เดิม — ต้องเปลี่ยนก็ต่อเมื่ออยากแยก attribution ตามงานหรือเปลี่ยน OA
     เท่านั้น ส่วนการห่อผ่าน /r/ (แผน B ที่เคยพิจารณา) จริงๆ ไม่ได้เพิ่ม
     GA4 attribution เลย เพราะเป็นแค่ 302 ไป LINE ตรงๆ ไม่ผ่านหน้าเว็บที่
     ติด GA4 เลย — มีประโยชน์แค่ "เปลี่ยนปลายทางทีหลังได้" อย่างเดียว

     รายการนี้เก็บไว้เป็นประวัติ (ตั้ง active:false แทนการลบ) ตามกฎเดิม
     ของไฟล์นี้ ไม่เคย resolve() สำเร็จอยู่แล้วตั้งแต่แรก (confirmed:false)
     ------------------------------------------------------------------ */
  'xstand-a-line': [
    {
      activation_id: 'QR-XS-A-LINE-01__T21KORAT-2026-09__r01',
      active: false,                   // retired 9 ก.ย. 2026 — ใช้ QR ของ LINE OA Manager ตรงๆ แทน
      confirmed: false,
      location: null, start_date: null, end_date: null,
      dest: '/free-sample',            // เดิมตั้งใจพา "รับ Free Resource" ผ่านหน้าเว็บก่อนตาม M1
      utm: {
        utm_source:   'offline',
        utm_medium:   'xstand',
        utm_campaign: 't21korat_sep2026',
        utm_content:  'qr_xs_a_line_01'
      },
      /* ไม่มี from=line เด็ดขาด (คงคอมเมนต์เดิมไว้เผื่อกลับมาใช้แนวทางนี้ในอนาคต)

         คนสแกน QR หน้าบูธยังไม่ได้เป็นเพื่อนใน LINE
         ถ้าเติม from=line หน้าเว็บจะข้ามขั้นชวนเพิ่มเพื่อนแล้วปล่อยไฟล์เลย
         = ได้ไฟล์ออกไปโดยไม่ได้เพื่อนกลับมาสักคน ซึ่งทำลายเป้าหมายของ funnel นี้
         from=line มีไว้สำหรับ rich menu ในแอป LINE เท่านั้น
         (คนกลุ่มนั้นเป็นเพื่อนอยู่แล้ว) — ดู content/line-rich-menu.md */
      note: 'RETIRED 9 ก.ย. 2026 — เปลี่ยนไปใช้ QR ของ LINE OA Manager ตรงบน X-stand แทน ' +
            '(เดิมตั้งใจ LINE QR = รับ Free Resource ผ่านหน้าเว็บก่อนตาม M1, CHANNELS บรรทัด 142)'
    }
  ]
};

/** token ที่ส่งมาหน้าตาถูกต้องไหม (ยังไม่ได้แปลว่ามีจริง) */
function isValidToken(t) {
  return typeof t === 'string' && TOKEN_RE.test(t);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** วันนี้ตามเวลาไทย ในรูปแบบ YYYY-MM-DD — ใช้เทียบกับ start_date/end_date */
function todayYMD() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** รอบที่ใช้งานอยู่และยืนยันแล้ว — null ถ้าไม่มี
 *
 *  เลือกรอบที่ start_date<=วันนี้<=end_date ก่อน (ตารางออกบูธที่กรอกไว้ล่วงหน้า)
 *  ถ้าวันนี้ไม่ตรงกับรอบไหนเลย fallback ไปรอบ evergreen (start_date/end_date
 *  เป็น null ทั้งคู่) กัน QR ที่พิมพ์ไปแล้ว 404 ตอนไม่มีบูธ
 *  ถ้าหลายรอบซ้อนวันที่กัน (มี X-stand หลายชุดพร้อมกันคนละที่) จะได้ตัวแรก
 *  ที่เจอในตาราง — attribution แยกที่มาไม่ได้ในช่วงที่ซ้อนกัน */
function current(token, map) {
  const M = map || MAP;
  if (!isValidToken(token)) return null;
  const rounds = M[token];
  if (!Array.isArray(rounds)) return null;
  if (!validate({ [token]: rounds }).ok) return null;

  const eligible = rounds.filter(r => r.active === true && r.confirmed === true);
  const today = todayYMD();
  const dated = eligible.find(r =>
    r.start_date && r.end_date && today >= r.start_date && today <= r.end_date);
  if (dated) return dated;
  return eligible.find(r => !r.start_date && !r.end_date) || null;
}

/** ประวัติทุกรอบของ token นี้ รวมรอบที่ยังไม่ยืนยันและรอบที่ปิดไปแล้ว */
function history(token, map) {
  const M = map || MAP;
  if (!isValidToken(token)) return [];
  return (M[token] || []).slice();
}

/**
 * สร้าง URL ปลายทาง — คืน found:false ถ้าไม่รู้จักหรือยังไม่ยืนยัน
 * ปลายทางมาจากตารางนี้เท่านั้น ไม่เคยอ่านจาก query string ของคนเรียก
 */
function resolve(token, map) {
  const a = current(token, map);
  if (!a) return { found: false, url: null, activation_id: null };

  const params = new URLSearchParams();
  Object.keys(a.utm || {}).forEach(k => params.set(k, a.utm[k]));

  // parameter ของเราเอง ไม่ใช่ utm_* — คงตัวพิมพ์ใหญ่ไว้ตามรูปแบบที่ตกลงกัน
  params.set('activation_id', a.activation_id);

  Object.keys(a.extra || {}).forEach(k => params.set(k, a.extra[k]));

  return { found: true, url: a.dest + '?' + params.toString(), activation_id: a.activation_id };
}

/**
 * ตรวจความถูกต้องของตารางทั้งใบ — ให้เทสต์เรียก
 * ผิดตรงนี้แปลว่า QR ที่พิมพ์แจกไปแล้วจะพาคนไปผิดที่
 */
function validate(map) {
  const M = map || MAP;
  const errors = [];
  const seenIds = new Set();

  Object.keys(M).forEach(token => {
    if (!isValidToken(token)) errors.push(token + ': รูปแบบ token ไม่ถูกต้อง');

    const rounds = M[token];
    if (!Array.isArray(rounds) || !rounds.length) {
      errors.push(token + ': ไม่มีรอบใดเลย');
      return;
    }

    // รอบ evergreen (start_date/end_date เป็น null ทั้งคู่) ที่ active ได้ไม่เกินหนึ่งรอบ —
    // ไม่งั้น current() จะเลือกไม่ถูกว่า fallback อันไหน ส่วนรอบที่มีวันที่ (dated)
    // ซ้อนกันได้ตามจริง (X-stand หลายชุดพร้อมกันคนละที่)
    if (rounds.filter(r => r && r.active === true && !r.start_date && !r.end_date).length > 1) {
      errors.push(token + ': มีรอบ evergreen (ไม่มีวันที่) ที่ active ได้ไม่เกินหนึ่งรอบ');
    }

    rounds.forEach(r => {
      if (!r || typeof r !== 'object') { errors.push(token + ': รอบผิดรูปแบบ'); return; }
      if (typeof r.active !== 'boolean') errors.push(token + ': active ต้องเป็น boolean');
      // ต้องมีทั้งคู่หรือไม่มีเลย ห้ามใส่แค่ครึ่งเดียว (เลี่ยง range ที่เปิดปลายด้านเดียวโดยไม่ตั้งใจ)
      if (!!r.start_date !== !!r.end_date) {
        errors.push(token + ': ' + (r.activation_id || '?') + ' ต้องมี start_date กับ end_date ครบคู่ หรือไม่มีทั้งคู่');
      }
      if (r.start_date && !YMD_RE.test(r.start_date)) errors.push(token + ': start_date ต้องเป็น YYYY-MM-DD -> ' + r.start_date);
      if (r.end_date && !YMD_RE.test(r.end_date)) errors.push(token + ': end_date ต้องเป็น YYYY-MM-DD -> ' + r.end_date);
      if (r.start_date && r.end_date && YMD_RE.test(r.start_date) && YMD_RE.test(r.end_date) && r.start_date > r.end_date) {
        errors.push(token + ': ' + (r.activation_id || '?') + ' start_date ต้องไม่มากกว่า end_date');
      }
      if (!ACTIVATION_RE.test(r.activation_id || '')) {
        errors.push(token + ': activation_id ผิดรูปแบบ -> ' + r.activation_id);
      }
      if (seenIds.has(r.activation_id)) errors.push('activation_id ซ้ำ: ' + r.activation_id);
      seenIds.add(r.activation_id);

      if (typeof r.confirmed !== 'boolean') {
        errors.push(token + ': ต้องระบุ confirmed เป็น true/false ให้ชัดเจน');
      }
      if (ALLOWED_DEST.indexOf(r.dest) === -1) {
        errors.push(token + ': ปลายทางไม่อยู่ใน allowlist -> ' + r.dest);
      }
      if (/^https?:|^\/\//i.test(String(r.dest))) {
        errors.push(token + ': ปลายทางต้องเป็น path ภายในเท่านั้น -> ' + r.dest);
      }
      // from=line เป็นของ rich menu เท่านั้น QR หน้างานห้ามมี
      if (r.extra && Object.keys(r.extra).some(k =>
        ['from', 'activation_id', 'utm_id'].includes(k.toLowerCase()) || k.toLowerCase().startsWith('utm_'))) {
        errors.push(token + ': ห้ามเติม from=line ให้ QR หน้างาน คนสแกนยังไม่ได้เป็นเพื่อน');
      }
    });
  });

  return { ok: errors.length === 0, errors };
}

/** รายการที่ยังรอยืนยันป้ายกำกับ — ใช้รายงานสถานะ */
function pending(map) {
  const M = map || MAP;
  const out = [];
  Object.keys(M).forEach(t => {
    M[t].filter(r => r.active && !r.confirmed).forEach(r => out.push({ token: t, activation_id: r.activation_id, note: r.note }));
  });
  return out;
}

module.exports = {
  MAP, ALLOWED_DEST, ACTIVATION_RE,
  isValidToken, current, history, resolve, validate, pending
};
