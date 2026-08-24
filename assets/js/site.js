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

  function consentValue() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function saveConsent(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  function loadTracking() {
    var a = C.ANALYTICS || {};

    if (a.GA4_ID) {
      var g = document.createElement("script");
      g.async = true;
      g.src = "https://www.googletagmanager.com/gtag/js?id=" + a.GA4_ID;
      document.head.appendChild(g);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", a.GA4_ID);
    }

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
    return !!(a.GA4_ID || a.META_PIXEL_ID || a.TIKTOK_PIXEL_ID);
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
    document.body.appendChild(el);

    $("[data-vk-allow]", el).addEventListener("click", function () {
      saveConsent("granted"); loadTracking(); el.remove();
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
    timelineHTML: timelineHTML
  };
})();
