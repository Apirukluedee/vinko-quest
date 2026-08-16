/* ============================================================
   VINKO — หน้าใบประกาศนักวิทย์น้อย

   ทำงานในเบราว์เซอร์ล้วน ไม่ส่งข้อมูลออกไปที่ไหนเลย
   จึงไม่มีข้อมูลส่วนบุคคลเข้าสู่ระบบเรา และไม่ต้องขอความยินยอมใดๆ
   ============================================================ */
(function () {
  "use strict";

  var C = (window.VINKO_CONFIG || {});
  var V = window.VINKO;
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var form = $("#vk-cert-form");
  if (!form) return;

  var nameInput = $("#vk-cert-name");
  var dateInput = $("#vk-cert-date");
  var listBox   = $("#vk-cert-missions");

  var TH_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                       "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

  /* ---------- สร้างรายการภารกิจจาก config ---------- */

  var missions = C.MISSIONS || [];

  missions.forEach(function (title, i) {
    var id = "vk-m" + (i + 1);
    var label = document.createElement("label");
    label.className = "vk-check vk-cert-mission";
    label.innerHTML =
      '<input id="' + id + '" type="checkbox" value="' + (i + 1) + '"/>' +
      '<span><b>' + (i + 1) + '.</b> ' + escapeHtml(title) + '</span>';
    listBox.appendChild(label);
  });

  /* ---------- วันที่เริ่มต้น = วันนี้ ---------- */

  var today = new Date();
  dateInput.value = today.getFullYear() + "-" +
    pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  /* ---------- เรนเดอร์ตัวอย่าง ---------- */

  function render() {
    var name = nameInput.value.trim();
    $("[data-vk-cert-name]").textContent = name || "ชื่อนักวิทย์น้อย";
    $("[data-vk-cert-name]").classList.toggle("is-placeholder", !name);

    // วันที่แบบไทย เช่น 17 สิงหาคม 2569
    var d = dateInput.value ? new Date(dateInput.value + "T00:00:00") : null;
    $("[data-vk-cert-date]").textContent = (d && !isNaN(d.getTime()))
      ? d.getDate() + " " + TH_MONTH_FULL[d.getMonth()] + " " + (d.getFullYear() + 543)
      : "";

    var picked = $$('input[type="checkbox"]:checked', listBox);
    var box = $("[data-vk-cert-list]");
    var ul = $("[data-vk-cert-items]");
    ul.innerHTML = "";

    if (!picked.length) {
      box.hidden = true;
    } else {
      picked.forEach(function (cb) {
        var li = document.createElement("li");
        li.textContent = missions[Number(cb.value) - 1];
        ul.appendChild(li);
      });
      // ครบทุกบทค่อยพูดว่าครบ ไม่งั้นบอกจำนวนตามจริง
      $("[data-vk-cert-count]").textContent = picked.length === missions.length
        ? "ครบทั้ง " + missions.length + " ภารกิจ"
        : picked.length + " จาก " + missions.length + " ภารกิจ";
      box.hidden = false;
      // เลือกเยอะ ตัวอักษรต้องเล็กลงเพื่อให้อยู่ในหน้าเดียว
      box.classList.toggle("is-dense", picked.length > 6);
    }
  }

  form.addEventListener("input", render);
  form.addEventListener("change", render);

  $("[data-vk-cert-all]").addEventListener("click", function () {
    $$('input[type="checkbox"]', listBox).forEach(function (c) { c.checked = true; });
    render();
  });
  $("[data-vk-cert-none]").addEventListener("click", function () {
    $$('input[type="checkbox"]', listBox).forEach(function (c) { c.checked = false; });
    render();
  });

  /* ---------- พิมพ์ ---------- */

  $("#vk-cert-print").addEventListener("click", function () {
    var slot = $('[data-vk-error-for="cert-name"]');
    if (!nameInput.value.trim()) {
      slot.textContent = "กรุณากรอกชื่อนักวิทย์น้อยก่อนพิมพ์";
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.focus();
      return;
    }
    slot.textContent = "";
    nameInput.removeAttribute("aria-invalid");
    window.print();
  });

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  render();
})();
