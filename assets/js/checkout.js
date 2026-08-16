/* ============================================================
   VINKO — หน้า checkout
   เลือกแพ็กเกจ / เลือกวิธีจ่าย / ตรวจฟอร์ม / คุยกับ /api/create-charge

   ข้อมูลบัตรถูก tokenize ด้วย Omise.js ในเบราว์เซอร์
   ส่งไป backend เฉพาะ token เลขบัตรไม่เคยผ่านเซิร์ฟเวอร์ของเรา
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
  var PKG_CODE = { lab: "LAB", bundle: "BUNDLE" };

  var busy = false;              // กันกดซ้ำระหว่างรอ API
  var clientRequestId = null;    // 1 ครั้งที่กดจ่าย = 1 id ยิงซ้ำได้ไม่เกิด charge ใหม่
  var pollTimer = null;
  var expireTimer = null;

  /* ---------- ตั้งค่า Omise.js ---------- */

  var omiseReady = false;

  function setupOmise() {
    if (!window.Omise) return Promise.resolve(false);
    var fromConfig = (V.cfg && V.cfg.OMISE_PUBLIC_KEY) || "";
    if (fromConfig) {
      window.Omise.setPublicKey(fromConfig);
      omiseReady = true;
      return Promise.resolve(true);
    }
    // static site ฝัง env ตอน build ไม่ได้ จึงขอ public key จาก /api/public-config
    return fetch("/api/public-config")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.omise_public_key) {
          window.Omise.setPublicKey(d.omise_public_key);
          omiseReady = true;
        }
        return omiseReady;
      })
      .catch(function () { return false; });
  }

  /* ---------- แพ็กเกจ + สรุปราคา ---------- */

  function selectedPkg() {
    var r = $('input[name="pkg"]:checked', form);
    var v = r ? r.value : "lab";
    return (v === "bundle" && !V.storiesReady()) ? "lab" : v;
  }

  function selectedMethod() {
    var r = $('input[name="payment_method"]:checked', form);
    return r ? r.value : "promptpay";
  }

  function applyPackage() {
    var pkg = selectedPkg();
    var isBundle = pkg === "bundle";
    var cfg = V.cfg.PRICES && V.cfg.PRICES[pkg];
    if (!cfg) return;

    var now = V.priceOf(pkg);
    var set = function (sel, val) { var e = $(sel); if (e) e.textContent = val; };
    set("[data-vk-sum-name]",      NAMES[pkg]);
    set("[data-vk-sum-price]",     V.baht(now));
    set("[data-vk-sum-total]",     V.baht(now));
    set("[data-vk-sum-normal]",    V.baht(cfg.normal));
    set("[data-vk-submit-amount]", V.baht(now));
    set("[data-vk-qr-amount]",     V.baht(now));

    $$("[data-vk-preorder-notice], [data-vk-check-preorder], [data-vk-sum-preorder]").forEach(function (el) {
      el.hidden = !isBundle;
    });

    var pre = $('input[name="agree_preorder"]');
    if (pre) {
      pre.required = isBundle;
      if (!isBundle) pre.checked = false;
    }
  }

  function applyMethod() {
    var isCard = selectedMethod() === "card";
    var box = $("[data-vk-card-fields]");
    if (box) box.hidden = !isCard;
  }

  /* ---------- รับค่าจาก query string ---------- */

  function applyQuery() {
    var m = /[?&]pkg=([a-z]+)/i.exec(window.location.search);
    if (!m) return;
    var want = m[1].toLowerCase();
    if (want === "bundle" && !V.storiesReady()) return;
    var radio = $('input[name="pkg"][value="' + want + '"]', form);
    if (radio) radio.checked = true;
  }

  /* ---------- ตรวจฟอร์ม ---------- */

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

    if (selectedMethod() === "card") {
      var num = ($("#vk-card-number") || {}).value || "";
      var nm  = ($("#vk-card-name") || {}).value || "";
      var exp = ($("#vk-card-exp") || {}).value || "";
      var cvc = ($("#vk-card-cvc") || {}).value || "";
      var digits = num.replace(/\D/g, "");
      var msg = "";
      if (digits.length < 13) msg = "กรุณากรอกหมายเลขบัตรให้ครบ";
      else if (!nm.trim()) msg = "กรุณากรอกชื่อบนบัตร";
      else if (!/^\d{2}\s*\/\s*\d{2}$/.test(exp.trim())) msg = "วันหมดอายุต้องอยู่ในรูปแบบ MM/YY";
      else if (!/^\d{3,4}$/.test(cvc.trim())) msg = "CVC ไม่ถูกต้อง";
      if (msg) { if (report) showError("card", msg); ok = false; }
      else showError("card", "");
    } else showError("card", "");

    return ok;
  }

  /* ---------- สถานะปุ่ม / ข้อความผิดพลาด ---------- */

  function setBusy(on) {
    busy = on;
    var btn = $("#vk-submit");
    var spin = $("[data-vk-spinner]");
    if (btn) btn.disabled = on;
    if (spin) spin.hidden = !on;
    form.classList.toggle("is-busy", on);
  }

  function showAlert(msg) {
    var box = $("[data-vk-alert]");
    if (!box) return;
    $("[data-vk-alert-msg]", box).textContent = msg;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function hideAlert() {
    var box = $("[data-vk-alert]");
    if (box) box.hidden = true;
  }

  /* ---------- tokenize บัตรด้วย Omise.js ---------- */

  function tokenizeCard() {
    return new Promise(function (resolve, reject) {
      if (!omiseReady || !window.Omise) {
        reject(new Error("ระบบชำระเงินด้วยบัตรยังไม่พร้อม กรุณาเลือก PromptPay หรือลองใหม่ภายหลัง"));
        return;
      }
      var exp = ($("#vk-card-exp").value || "").split("/");
      window.Omise.createToken("card", {
        name: $("#vk-card-name").value.trim(),
        number: $("#vk-card-number").value.replace(/\D/g, ""),
        expiration_month: parseInt(exp[0], 10),
        expiration_year: 2000 + parseInt(exp[1], 10),
        security_code: $("#vk-card-cvc").value.trim()
      }, function (status, response) {
        if (status === 200 && response && response.id) resolve(response.id);
        else reject(new Error((response && response.message) || "ข้อมูลบัตรไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง"));
      });
    });
  }

  /* ---------- ส่งคำสั่งซื้อ ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;                       // กดรัวก็ไม่ยิงซ้ำ
    hideAlert();

    if (!validate(true)) {
      var bad = $('[aria-invalid="true"]', form);
      if (bad) bad.focus();
      return;
    }

    setBusy(true);

    // id เดิมตลอดความพยายามครั้งนี้ ถ้า request หลุดแล้วผู้ใช้กดใหม่
    // server จะคืนออเดอร์เดิมแทนการสร้าง charge ใหม่
    if (!clientRequestId) clientRequestId = newId();

    var method = selectedMethod();
    var prep = method === "card" ? tokenizeCard() : Promise.resolve(null);

    prep.then(function (token) {
      return fetch("/api/create-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // ส่งแค่รหัสแพ็กเกจ ไม่ส่งราคา — ราคา server เปิดตารางเอง
          package_code: PKG_CODE[selectedPkg()],
          payment_method: method,
          card_token: token,
          customer_name: $('[name="name"]', form).value.trim(),
          customer_email: $('[name="email"]', form).value.trim(),
          customer_phone: $('[name="phone"]', form).value.trim(),
          consent_terms: $('[name="agree_terms"]', form).checked,
          consent_privacy: $('[name="agree_privacy"]', form).checked,
          consent_preorder: !!($('[name="agree_preorder"]', form) || {}).checked,
          client_request_id: clientRequestId
        })
      });
    }).then(function (res) {
      return res.json().then(function (d) { return { status: res.status, data: d }; });
    }).then(function (r) {
      var d = r.data || {};
      if (!d.ok) throw new Error(d.error || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");

      // เก็บไว้ให้หน้า thank-you ยืนยันตัวตนเพื่อขอลิงก์ดาวน์โหลดทันที
      // โดยไม่ต้องรออีเมล (ดู /api/claim-download)
      try {
        sessionStorage.setItem("vinko_last_order", JSON.stringify({
          ref: d.order_ref, rid: clientRequestId
        }));
      } catch (e) {}

      if (d.payment_method === "promptpay") {
        if (!d.qr_image_url) throw new Error("ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่อีกครั้ง");
        showQrStage(d);
        return;
      }

      // บัตร: 3-D Secure ต้องพาไปหน้าธนาคารก่อน
      if (d.authorize_uri) { window.location.href = d.authorize_uri; return; }
      if (d.charge_status === "successful") {
        window.location.href = "/thank-you?ref=" + encodeURIComponent(d.order_ref);
        return;
      }
      throw new Error(d.failure_message || "ชำระเงินไม่สำเร็จ กรุณาตรวจสอบข้อมูลบัตรหรือลองวิธีอื่น");
    }).catch(function (err) {
      setBusy(false);
      // ความพยายามครั้งนี้จบแล้ว ครั้งหน้าถือเป็นออเดอร์ใหม่
      clientRequestId = null;
      showAlert(err.message || "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    });
  });

  var retryBtn = $("[data-vk-retry]");
  if (retryBtn) retryBtn.addEventListener("click", function () {
    hideAlert();
    setBusy(false);
    // ข้อมูลที่กรอกไว้ยังอยู่ครบ ไม่ล้างฟอร์ม
  });

  /* ---------- หน้าจอ QR PromptPay ---------- */

  function showQrStage(d) {
    var stage = $("[data-vk-qr-stage]");
    if (!stage) return;

    $("[data-vk-qr-img]").src = d.qr_image_url;
    $("[data-vk-qr-ref]").textContent = d.order_ref;

    form.closest("section").hidden = true;
    var head = $(".vk-page-head");
    if (head) head.hidden = true;
    stage.hidden = false;
    window.scrollTo(0, 0);

    startExpiry(d.expires_at);
    startPolling(d.order_ref);
  }

  function startPolling(ref) {
    stopPolling();
    var tries = 0;
    pollTimer = setInterval(function () {
      tries++;
      if (tries > 400) { stopPolling(); return; }   // ~20 นาที
      fetch("/api/order-status?ref=" + encodeURIComponent(ref))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) return;
          if (d.status === "paid") {
            stopPolling();
            window.location.href = "/thank-you?ref=" + encodeURIComponent(ref);
          } else if (d.status === "failed" || d.status === "expired") {
            stopPolling();
            qrAlert(d.status === "expired"
              ? "QR หมดอายุแล้ว กรุณาย้อนกลับไปสร้างรายการใหม่"
              : "การชำระเงินไม่สำเร็จ กรุณาย้อนกลับไปลองใหม่อีกครั้ง");
          }
        })
        .catch(function () { /* เน็ตสะดุดชั่วคราว รอบหน้าลองใหม่ */ });
    }, 3000);
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function startExpiry(expiresAt) {
    if (expireTimer) clearInterval(expireTimer);
    var box = $("[data-vk-qr-expire]");
    var out = $("[data-vk-qr-countdown]");
    if (!expiresAt || !box || !out) return;
    var end = new Date(expiresAt).getTime();
    if (isNaN(end)) return;

    function tick() {
      var left = end - Date.now();
      if (left <= 0) {
        clearInterval(expireTimer);
        box.hidden = true;
        qrAlert("QR หมดอายุแล้ว กรุณาย้อนกลับไปสร้างรายการใหม่");
        stopPolling();
        return;
      }
      var m = Math.floor(left / 60000);
      var s = Math.floor(left / 1000) % 60;
      out.textContent = m + ":" + (s < 10 ? "0" + s : s);
      box.hidden = false;
    }
    tick();
    expireTimer = setInterval(tick, 1000);
  }

  function qrAlert(msg) {
    var box = $("[data-vk-qr-alert]");
    var wait = $("[data-vk-qr-waiting]");
    if (wait) wait.hidden = true;
    if (!box) return;
    $("[data-vk-qr-alert-msg]", box).textContent = msg;
    box.hidden = false;
  }

  var cancelBtn = $("[data-vk-qr-cancel]");
  if (cancelBtn) cancelBtn.addEventListener("click", function () {
    stopPolling();
    if (expireTimer) clearInterval(expireTimer);
    $("[data-vk-qr-stage]").hidden = true;
    form.closest("section").hidden = false;
    var head = $(".vk-page-head");
    if (head) head.hidden = false;
    setBusy(false);
    clientRequestId = null;      // ย้อนกลับมาแก้ = ถือเป็นออเดอร์ใหม่
    window.scrollTo(0, 0);
  });

  /* ---------- ช่วยกรอกบัตรให้อ่านง่าย ---------- */

  var cardNum = $("#vk-card-number");
  if (cardNum) cardNum.addEventListener("input", function () {
    var d = this.value.replace(/\D/g, "").slice(0, 19);
    this.value = d.replace(/(.{4})/g, "$1 ").trim();
  });

  var cardExp = $("#vk-card-exp");
  if (cardExp) cardExp.addEventListener("input", function () {
    var d = this.value.replace(/\D/g, "").slice(0, 4);
    this.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
  });

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "vk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- เริ่มทำงาน ---------- */

  form.addEventListener("change", function (e) {
    if (e.target.name === "pkg") applyPackage();
    if (e.target.name === "payment_method") { applyMethod(); hideAlert(); }
  });

  function start() {
    applyQuery();
    applyPackage();
    applyMethod();
    setupOmise();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
