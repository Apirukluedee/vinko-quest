/* ============================================================
   VINKO — หน้า checkout: เลือกแพ็กเกจ / สรุปราคา / ตรวจฟอร์ม
   ปุ่มชำระเงินยัง disabled อยู่ รอเชื่อม Omise รอบหน้า
   ============================================================ */
(function () {
  "use strict";

  var V = window.VINKO;
  var form = document.getElementById("vk-checkout");
  if (!form || !V) return;

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var NAMES = {
    lab:    "VINKO WOW LAB",
    bundle: "BUNDLE: LAB + นิทาน 5 เรื่อง"
  };

  /* ---------- เลือกแพ็กเกจ ---------- */

  function selected() {
    var r = $('input[name="pkg"]:checked', form);
    var v = r ? r.value : "lab";
    // กันกรณีคนแก้ URL เป็น bundle ทั้งที่ยังไม่เปิดขาย pre-order
    return (v === "bundle" && !V.storiesReady()) ? "lab" : v;
  }

  function applyPackage() {
    var pkg = selected();
    var isBundle = pkg === "bundle";
    var cfg = V.cfg.PRICES && V.cfg.PRICES[pkg];
    if (!cfg) return;

    var now = V.priceOf(pkg);
    var set = function (sel, val) { var e = $(sel); if (e) e.textContent = val; };
    set("[data-vk-sum-name]",   NAMES[pkg]);
    set("[data-vk-sum-price]",  V.baht(now));
    set("[data-vk-sum-total]",  V.baht(now));
    set("[data-vk-sum-normal]", V.baht(cfg.normal));

    // ส่วนที่โผล่เฉพาะตอนเลือก BUNDLE
    $$("[data-vk-preorder-notice], [data-vk-check-preorder], [data-vk-sum-preorder]").forEach(function (el) {
      el.hidden = !isBundle;
    });

    var pre = $('input[name="agree_preorder"]');
    if (pre) {
      pre.required = isBundle;          // บังคับติ๊กเฉพาะตอนซื้อ bundle
      if (!isBundle) pre.checked = false;
    }
  }

  /* ---------- รับค่าจาก query string: /checkout?pkg=bundle ---------- */

  function applyQuery() {
    var m = /[?&]pkg=([a-z]+)/i.exec(window.location.search);
    if (!m) return;
    var want = m[1].toLowerCase();
    if (want === "bundle" && !V.storiesReady()) return;   // ยังไม่เปิด pre-order
    var radio = $('input[name="pkg"][value="' + want + '"]', form);
    if (radio) radio.checked = true;
  }

  /* ---------- ตรวจฟอร์มฝั่ง client ---------- */

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  var PHONE_RE = /^[0-9+\-\s()]{9,20}$/;

  function showError(name, msg) {
    var slot = $('[data-vk-error-for="' + name + '"]');
    if (slot) slot.textContent = msg || "";
    var field = $('[name="' + name + '"]', form);
    if (field && field.type !== "checkbox") {
      if (msg) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
  }

  function validate(report) {
    var ok = true;
    var v = function (n) { var e = $('[name="' + n + '"]', form); return e ? e.value.trim() : ""; };

    if (!v("name")) { if (report) showError("name", "กรุณากรอกชื่อ-นามสกุล"); ok = false; }
    else showError("name", "");

    var email = v("email");
    if (!email) { if (report) showError("email", "กรุณากรอกอีเมล"); ok = false; }
    else if (!EMAIL_RE.test(email)) { if (report) showError("email", "รูปแบบอีเมลไม่ถูกต้อง"); ok = false; }
    else showError("email", "");

    var phone = v("phone");
    if (phone && !PHONE_RE.test(phone)) { if (report) showError("phone", "รูปแบบเบอร์โทรไม่ถูกต้อง"); ok = false; }
    else showError("phone", "");

    var missing = ["agree_terms", "agree_privacy", "agree_preorder"].filter(function (n) {
      var c = $('[name="' + n + '"]', form);
      return c && c.required && !c.checked;
    });
    if (missing.length) {
      if (report) showError("checks", "กรุณาติ๊กยอมรับเงื่อนไขให้ครบทุกข้อ");
      ok = false;
    } else showError("checks", "");

    return ok;
  }

  /* ---------- ปุ่มชำระเงิน ---------- */
  /* ตอนนี้ปิดไว้เสมอเพราะยังไม่ได้ต่อ Omise
     พอต่อจริงแล้วให้เปลี่ยนเป็น  btn.disabled = !valid;  */

  function refreshSubmit() {
    validate(false);
  }

  form.addEventListener("change", function (e) {
    if (e.target.name === "pkg") applyPackage();
    refreshSubmit();
  });
  form.addEventListener("input", refreshSubmit);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate(true)) {
      var bad = $('[aria-invalid="true"]', form);
      if (bad) bad.focus();
      return;
    }
    // TODO: Omise integration — สร้าง token แล้วส่งไป backend ที่นี่
  });

  // config.js/site.js โหลดก่อนไฟล์นี้แล้ว แต่ site.js ซ่อน/แสดง bundle ตอน DOMContentLoaded
  function start() { applyQuery(); applyPackage(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
