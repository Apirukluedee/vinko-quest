/* ============================================================
   VINKO WOW LAB — สคริปต์กลางของทุกหน้า
   อ่านค่าทั้งหมดจาก /assets/js/config.js ไม่ hardcode ที่ไหนอีก
   ============================================================ */
(function () {
  "use strict";

  var C = window.VINKO_CONFIG || {};
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- ราคา ---------- */

  function promoEnd() {
    if (!C.LAUNCH_PROMO_END) return null;
    var d = new Date(C.LAUNCH_PROMO_END);
    return isNaN(d.getTime()) ? null : d;
  }

  // ยังอยู่ในช่วงราคาเปิดตัวไหม — ถ้ายังไม่กำหนดวันหมด ถือว่ายังอยู่
  function promoActive() {
    var e = promoEnd();
    return e === null ? true : Date.now() < e.getTime();
  }

  function baht(n) { return Number(n).toLocaleString("th-TH"); }

  // ราคาที่ต้องเก็บจริงของแพ็กเกจนั้นในตอนนี้
  function priceOf(pkg) {
    var p = (C.PRICES || {})[pkg];
    if (!p) return null;
    return promoActive() ? p.launch : p.normal;
  }

  /* ---------- กำหนดส่งนิทาน ---------- */

  var TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  function thaiDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00+07:00");
    if (isNaN(d.getTime())) return "";
    return d.getDate() + " " + TH_MONTH[d.getMonth()] + " " + (d.getFullYear() + 543);
  }

  // แสดง BUNDLE ได้เมื่อมีวันส่งมอบอย่างน้อย 1 เรื่อง หรือเรื่องใดพร้อมส่งทันที
  function storyAvailable(x) { return x.date === 'instant' || !!thaiDate(x.date); }

  function storiesReady() {
    var s = C.STORY_DELIVERY || [];
    return s.length === 5 && s.some(storyAvailable);
  }

  // มีเล่มไหนใน STORY_DELIVERY ที่ยังไม่ใช่ instant ไหม — ใช้แยกจาก
  // storiesReady() เพราะ "พร้อมขายบ้างแล้ว" กับ "ไม่มี pre-order ค้างแล้ว"
  // คนละเงื่อนไขกัน (เช่นตอนนี้ทั้ง 5 เล่ม instant หมด = ไม่มี pre-order
  // เหลือ แต่ก่อนหน้านี้บางเล่ม instant บางเล่มยังมีกำหนดส่ง = ยังมี pre-order)
  function hasPreorder() {
    var s = C.STORY_DELIVERY || [];
    return s.some(function (x) { return x.date !== 'instant'; });
  }

  function storyDateLabel(s) {
    if (s.date === 'instant') return 'ได้ทันที';
    var d = thaiDate(s.date);
    return d || 'เร็วๆ นี้';
  }

  function timelineHTML() {
    return '<ol class="vk-timeline">' + (C.STORY_DELIVERY || []).map(function (s) {
      return '<li><span class="vk-tl-no">' + s.no + '</span>' +
             '<span class="vk-tl-text"><span class="vk-tl-title">' + s.title + '</span>' +
             (s.title_en ? '<span class="vk-tl-title-en">' + s.title_en + '</span>' : '') +
             '</span>' +
             '<span class="vk-tl-date">' + storyDateLabel(s) + '</span></li>';
    }).join("") + '</ol>';
  }

  /* ---------- เรนเดอร์ราคาในหน้า ---------- */

  function renderPrices() {
    var active = promoActive();

    $$("[data-vk-price]").forEach(function (el) {
      var p = (C.PRICES || {})[el.getAttribute("data-vk-price")];
      if (p) el.textContent = baht(active ? p.launch : p.normal);
    });

    $$("[data-vk-price-normal]").forEach(function (el) {
      var p = (C.PRICES || {})[el.getAttribute("data-vk-price-normal")];
      if (p) el.textContent = baht(p.normal);
    });

    $$("[data-vk-upgrade-price]").forEach(function (el) {
      if (C.UPGRADE_PRICE) el.textContent = baht(C.UPGRADE_PRICE);
    });

    // หมดช่วงเปิดตัวแล้ว: ซ่อนราคาขีดฆ่าและป้าย "ราคาเปิดตัว" ให้หมด
    if (!active) $$("[data-vk-launch-only]").forEach(function (el) { el.hidden = true; });
  }

  /* ---------- นับถอยหลัง (ของจริง ไม่รีเซ็ตตัวเอง) ---------- */

  function renderCountdown() {
    var box = $("[data-vk-countdown]");
    if (!box) return;
    var end = promoEnd();
    if (!end) { box.hidden = true; return; }   // ยังไม่กำหนดวัน = ซ่อน ไม่โชว์ 00:00:00

    var timer = null;

    function tick() {
      var left = end.getTime() - Date.now();
      if (left <= 0) {
        box.hidden = true;
        renderPrices();                        // สลับไปราคาปกติทันทีที่หมดเวลา
        if (timer) clearInterval(timer);
        return;
      }
      var d = Math.floor(left / 86400000);
      var h = Math.floor(left / 3600000) % 24;
      var m = Math.floor(left / 60000) % 60;
      var set = function (sel, v) {
        var e = $(sel, box);
        if (e) e.textContent = v < 10 ? "0" + v : String(v);
      };
      set("[data-vk-cd-d]", d);
      set("[data-vk-cd-h]", h);
      set("[data-vk-cd-m]", m);
      box.hidden = false;
    }

    tick();
    timer = setInterval(tick, 30000);
  }

  /* ---------- ตัวนับ pre-order (ยอดจริงเท่านั้น) ---------- */

  function renderPreorder() {
    var el = $("[data-vk-preorder]");
    if (!el) return;
    var lim = C.PREORDER_LIMIT, sold = C.PREORDER_SOLD;
    if (typeof lim !== "number" || typeof sold !== "number" || lim <= 0) { el.hidden = true; return; }
    var left = Math.max(0, lim - sold);
    el.textContent = left > 0
      ? "เหลืออีก " + baht(left) + " ชุด จากทั้งหมด " + baht(lim) + " ชุด"
      : "รอบนี้เต็มแล้ว";
    el.hidden = false;
  }

  /* ---------- BUNDLE / ไทม์ไลน์ ---------- */

  function renderBundle() {
    var ready = storiesReady();
    $$("[data-vk-timeline]").forEach(function (el) {
      if (ready) { el.innerHTML = timelineHTML(); el.hidden = false; }
      else { el.hidden = true; }
    });
    // ยังไม่รู้วันส่งมอบ = ยังขาย pre-order ไม่ได้ ซ่อนแพ็กเกจ BUNDLE ไปก่อน
    $$("[data-vk-bundle]").forEach(function (el) { el.hidden = !ready; });
    // ข้อความ "รอกำหนดวันที่จริง" ในหน้า Terms — โชว์เฉพาะตอนที่ยังไม่มีวัน
    $$("[data-vk-bundle-missing]").forEach(function (el) { el.hidden = ready; });
    // เงื่อนไข/ข้อความเฉพาะสินค้า pre-order (ข้อ 4 ในหน้า Terms ฯลฯ) —
    // โชว์เฉพาะตอนที่ยังมีเล่มค้าง pre-order จริง ไม่ใช่ตอนที่พร้อมขายแล้ว
    var pre = hasPreorder();
    $$("[data-vk-preorder-active]").forEach(function (el) { el.hidden = !pre; });
    $$("[data-vk-preorder-none]").forEach(function (el) { el.hidden = pre; });
  }

  /* ---------- ข้อมูลผู้ขาย / ติดต่อ ---------- */

  function renderContact() {
    var mail = C.CONTACT_EMAIL || "";
    $$("[data-vk-email]").forEach(function (el) {
      if (mail) {
        el.textContent = mail;
        if (el.tagName === "A") el.href = "mailto:" + mail;
      }
    });
    $$("[data-vk-line]").forEach(function (el) { if (C.LINE_URL) el.href = C.LINE_URL; });
    $$("[data-vk-seller-name]").forEach(function (el) {
      if (C.SELLER && C.SELLER.name) el.textContent = C.SELLER.name;
    });
    $$("[data-vk-seller-address]").forEach(function (el) {
      if (C.SELLER && C.SELLER.address) el.textContent = C.SELLER.address;
    });
    $$("[data-vk-year]").forEach(function (el) { el.textContent = new Date().getFullYear() + 543; });
  }

  /* ---------- Cookie consent + tracking ---------- */

  var KEY = "vinko_consent";
  var consentMemory = null;
  var gaStarted = false;
  var gaReady = false;

  function consentValue() { try { return localStorage.getItem(KEY) || consentMemory; } catch (e) { return consentMemory; } }
  function saveConsent(v) { consentMemory = v; try { localStorage.setItem(KEY, v); } catch (e) {} }

  /* ยิงเข้า property จากโดเมนจริงเท่านั้น
     Vercel สร้าง preview URL ใหม่ทุกครั้งที่ push ถ้าไม่กันตรงนี้
     ทราฟฟิกตอนทดสอบจะปนกับข้อมูลลูกค้าจริง และ GA4 ลบ event ย้อนหลังไม่ได้ */
  function isProdHost() {
    var h = location.hostname;
    return h === "vinko.quest" || h === "www.vinko.quest";
  }

  /* เลือก property ตามที่อยู่ที่หน้าเว็บถูกเปิด — ห้ามปนกันเด็ดขาด
       โดเมนจริง  -> GA4_ID       (ข้อมูลลูกค้าจริง)
       ที่อื่น      -> GA4_TEST_ID  (localhost, preview ของ Vercel, มือถือที่ต่อเข้ามาทดสอบ)
     GA4 ลบ event ย้อนหลังไม่ได้ ถ้าปนแล้วปนเลย รายงานเดือนแรกจะเชื่อไม่ได้ */
  function ga4Id() {
    var a = C.ANALYTICS || {};
    var id = isProdHost() ? a.GA4_ID : a.GA4_TEST_ID;
    if (typeof id !== 'string' || !/^G-[A-Z0-9]+$/.test(id)) return "";
    if (!isProdHost() && (id === a.GA4_ID || id === 'G-W9W53C5DWS')) return "";
    return id;
  }

  function loadTracking() {
    var a = C.ANALYTICS || {};
    var gid = ga4Id();

    if (gid && !gaStarted) {
      gaStarted = true;
      var g = document.createElement("script");
      g.async = true;
      g.src = "https://www.googletagmanager.com/gtag/js?id=" + gid;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      // debug_mode ทำให้ event โผล่ใน DebugView ทันที ใช้ตอนทดสอบเท่านั้น
      window.gtag("config", gid, isProdHost() ? {} : { debug_mode: true });
      g.onload = function () {
        gaReady = true;
        try { window.dispatchEvent(new CustomEvent("vinko:analytics-ready")); } catch (e) {}
      };
      g.onerror = function () { gaReady = false; };
      document.head.appendChild(g);
    }

    // pixel โฆษณาโหลดบนโดเมนจริงเท่านั้น ไม่มี test pixel ให้ใช้
    if (!isProdHost()) return;

    if (a.META_PIXEL_ID) {
      (function (f, b, e, v) {
        var n, t, s;
        if (f.fbq) return;
        n = f.fbq = function () {
          n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", a.META_PIXEL_ID);
      window.fbq("track", "PageView");
    }

    if (a.TIKTOK_PIXEL_ID) {
      (function (w, d, t) {
        w.TiktokAnalyticsObject = t;
        var ttq = w[t] = w[t] || [];
        ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off",
                       "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
        ttq.setAndDefer = function (obj, m) {
          obj[m] = function () { obj.push([m].concat(Array.prototype.slice.call(arguments, 0))); };
        };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        ttq.load = function (id) {
          var r = "https://analytics.tiktok.com/i18n/pixel/events.js";
          ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = r;
          ttq._t = ttq._t || {}; ttq._t[id] = +new Date();
          ttq._o = ttq._o || {}; ttq._o[id] = {};
          var o = d.createElement("script");
          o.type = "text/javascript"; o.async = true;
          o.src = r + "?sdkid=" + id + "&lib=" + t;
          var a2 = d.getElementsByTagName("script")[0];
          a2.parentNode.insertBefore(o, a2);
        };
      })(window, document, "ttq");
      window.ttq.load(a.TIKTOK_PIXEL_ID);
      window.ttq.page();
    }
  }

  function hasAnyPixel() {
    var a = C.ANALYTICS || {};
    // ไม่มีอะไรจะยิง = ไม่ต้องรบกวนคนเข้าเว็บด้วยแบนเนอร์
    // บน local/preview จะมีก็ต่อเมื่อใส่ GA4_TEST_ID ไว้แล้วเท่านั้น
    if (!isProdHost()) return !!ga4Id();
    return !!(a.GA4_ID || a.META_PIXEL_ID || a.TIKTOK_PIXEL_ID);
  }

  /* ---------- UTM + event ----------

     เก็บ UTM "หลังได้ consent เท่านั้น" ตามที่ตกลงไว้
     ผลที่ยอมรับ: คนที่กดยอมรับตอนอยู่หน้าที่สองแล้ว first-touch จะหายไป
     เลือกเสียตัวเลขดีกว่าเลี่ยง consent เพื่อให้ตัวเลขครบ                    */

  var ATTR_KEY = "vinko_attr";
  var UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function readUtm() {
    var q = new URLSearchParams(location.search);
    var out = null;

    UTM_FIELDS.forEach(function (k) {
      var v = q.get(k);
      if (!v) return;
      out = out || {};
      // lowercase กัน utm_source=Facebook กับ facebook แตกเป็นสองแถวในรายงาน
      out[k] = String(v).slice(0, 100).toLowerCase();
    });

    /* activation_id = รอบการใช้งานของ QR หนึ่งใบ (QR_ID__EVENT_CODE__rNN)
       เป็น parameter ของเราเอง ไม่ใช่ utm_id เพราะ Google นิยาม utm_id
       ว่าเป็นรหัส "แคมเปญ" คนละความหมายกัน ถ้ายัดใส่ utm_id รายงาน Campaign
       จะแตกเป็นราย QR แทนที่จะรวมเป็นงานเดียว
       รูปแบบนี้เป็นตัวพิมพ์ใหญ่ ห้าม lowercase ไม่งั้นเทียบกลับไม่ตรง */
    var aid = q.get("activation_id");
    if (aid) { out = out || {}; out.activation_id = String(aid).slice(0, 100); }

    return out;
  }

  function captureAttribution() {
    if (consentValue() !== "granted") return;
    var hit = readUtm();
    if (!hit) return;                      // ไม่มี utm = direct ไม่ทับค่าเดิม
    var store = {};
    try { store = JSON.parse(localStorage.getItem(ATTR_KEY) || "{}") || {}; } catch (e) {}
    if (typeof store !== 'object' || Array.isArray(store)) store = {};
    hit.t = new Date().toISOString();
    if (!store.first) store.first = hit;   // first-touch เขียนครั้งเดียวตลอดกาล
    store.last = hit;                      // last non-direct ทับได้เรื่อยๆ
    try { localStorage.setItem(ATTR_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function attribution() {
    if (consentValue() !== "granted") return {};
    try {
      var stored = JSON.parse(localStorage.getItem(ATTR_KEY) || "{}");
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    } catch (e) { return {}; }
  }

  // Explicit event parameters persist across pages. These are custom dimensions,
  // not an override of GA4's native traffic-source attribution model.
  function attributionParams() {
    var stored = attribution(), out = {};
    ['first', 'last'].forEach(function (touch) {
      var hit = stored[touch];
      if (!hit || typeof hit !== 'object') return;
      UTM_FIELDS.concat(['activation_id']).forEach(function (key) {
        if (typeof hit[key] === 'string') out[touch + '_' + key] = hit[key].slice(0, 100);
      });
    });
    if (stored.last && typeof stored.last.activation_id === 'string') {
      out.activation_id = stored.last.activation_id.slice(0, 100);
    }
    return out;
  }

  /**
   * ยิง event — เงียบสนิทถ้ายังไม่ได้ consent หรือ GA4 ยังไม่โหลด
   * คืน true เฉพาะตอนที่ "เรียก gtag ไปแล้วจริง" ไม่ได้แปลว่า GA4 รับสำเร็จ
   * ห้ามใส่ชื่อ อีเมล เบอร์โทร หรือคำตอบแบบสำรวจลง params เด็ดขาด
   */
  function track(name, params) {
    if (consentValue() !== "granted") return false;
    if (!ga4Id() || !gaReady || typeof window.gtag !== "function") return false;
    params = params || {};
    if (name === 'purchase' && params.payment_mode !== (isProdHost() ? 'live' : 'test')) return false;
    var eventParams = Object.assign({}, attributionParams(), params, { send_to: ga4Id() });
    try { window.gtag("event", name, eventParams); } catch (e) { return false; }
    return true;
  }

  function consentBanner() {
    if (consentValue() === "granted") { loadTracking(); return; }
    if (consentValue() === "denied") return;
    if (!hasAnyPixel()) return;   // ยังไม่ใส่ ID = ไม่มีอะไรให้ยินยอม ไม่ต้องรบกวนคนเข้าเว็บ

    var el = document.createElement("div");
    el.className = "vk-consent";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "การใช้คุกกี้");
    el.innerHTML =
      '<p>เราใช้คุกกี้เพื่อวัดผลการเข้าชมและปรับปรุงเว็บไซต์ ' +
      'คุณเลือกไม่ยอมรับได้ เว็บยังใช้งานได้ตามปกติ ' +
      '<a href="/privacy">อ่านนโยบายความเป็นส่วนตัว</a></p>' +
      '<div class="vk-consent-actions">' +
      '<button class="btn light" data-vk-deny type="button">ไม่ยอมรับ</button>' +
      '<button class="btn" data-vk-allow type="button">ยอมรับ</button>' +
      '</div>';
    /* วางไว้บนสุดของหน้า "ในสายเลย์เอาต์ปกติ" ไม่ใช่ position:fixed

       เดิมเป็นแถบลอยก้นจอ วัดจริงบนมือถือ 375x812 หน้า /checkout แล้วพบว่า
       มันทับปุ่ม "ชำระเงิน" และช่องยอมรับเงื่อนไข 38px กดไม่โดน
       (elementFromPoint กลางปุ่มชี้มาที่ .vk-consent)

       เคยลองแก้ด้วยการเว้น padding ท้ายหน้า แต่วัดแล้วไม่ได้ผล —
       แถบลอยย่อมบังทุกอย่างที่เลื่อนมาอยู่ใต้มัน เป็นธรรมชาติของ fixed เอง
       การเลื่อนหนีได้ไม่เท่ากับแก้แล้ว

       อยู่ในสายเลย์เอาต์ = ดันเนื้อหาลงมา ไม่ทับอะไรเลยในทุกตำแหน่ง scroll
       แลกกับการที่แถบเลื่อนพ้นจอไปได้ ซึ่งรับได้ เพราะยังไม่กดยอมรับ
       = ยังไม่โหลด analytics อยู่แล้ว ไม่มีอะไรเสียหาย
       ห้ามแก้ด้วยการซ่อนแบนเนอร์ในหน้า checkout เพราะเท่ากับเก็บข้อมูลโดยไม่ขอ */
    el.classList.add("vk-consent-inflow");
    document.body.insertBefore(el, document.body.firstChild);

    $("[data-vk-allow]", el).addEventListener("click", function () {
      saveConsent("granted");
      captureAttribution();
      loadTracking();
      el.remove();
      // หน้าที่ค้างงานรอ consent อยู่ (เช่น /thank-you รอยิง purchase)
      // ต้องได้โอกาสส่งโดยไม่ต้องให้ลูกค้ารีเฟรช
      try { window.dispatchEvent(new CustomEvent("vinko:consent-granted")); } catch (e) {}
    });
    $("[data-vk-deny]", el).addEventListener("click", function () {
      saveConsent("denied"); el.remove();
    });
  }

  /* ---------- เปิดใช้งาน ---------- */

  function init() {
    renderPrices();
    renderCountdown();
    renderPreorder();
    renderBundle();
    renderContact();
    consentBanner();
    captureAttribution();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ให้หน้า checkout เรียกใช้ต่อได้
  window.VINKO = {
    cfg: C,
    baht: baht,
    thaiDate: thaiDate,
    priceOf: priceOf,
    promoActive: promoActive,
    storiesReady: storiesReady,
    hasPreorder: hasPreorder,
    timelineHTML: timelineHTML,
    track: track,
    attribution: attribution,
    ga4Id: ga4Id,
    isProdHost: isProdHost,
    consentGranted: function () { return consentValue() === "granted"; }
  };
})();
