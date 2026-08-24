/* ============================================================
   VINKO — หน้า /download
   แสดงรายการไฟล์ของออเดอร์ตาม token ที่อยู่ใน URL
   ไม่มี URL ของ Storage โผล่มาที่ฝั่งนี้เลย ทุกไฟล์วิ่งผ่าน /api/download
   ============================================================ */
(function () {
  "use strict";

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var token = new URLSearchParams(window.location.search).get("token") || "";

  var TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  function thaiDate(iso) {
    if (!iso) return "";
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00+07:00");
    return isNaN(d.getTime()) ? ""
      : d.getDate() + " " + TH_MONTH[d.getMonth()] + " " + (d.getFullYear() + 543);
  }

  function thaiDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("th-TH", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
    }) + " น.";
  }

  function showError(msg, canResend) {
    $("[data-vk-dl-loading]").hidden = true;
    $("[data-vk-dl-main]").hidden = true;
    var box = $("[data-vk-dl-error]");
    $("[data-vk-dl-error-msg]", box).textContent = msg;
    $("[data-vk-dl-resend]", box).hidden = !canResend;
    box.hidden = false;
  }

  /* ---------- โหลดรายการไฟล์ ---------- */

  if (!token) {
    showError("ลิงก์ไม่ถูกต้อง กรุณาเปิดจากลิงก์ในอีเมลที่เราส่งให้", false);
    return;
  }

  fetch("/api/download-info?token=" + encodeURIComponent(token))
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
    .then(function (res) {
      var d = res.d || {};
      if (!d.ok) {
        // หมดอายุยังขอลิงก์ใหม่ได้ ผิดรูปแบบขอไม่ได้
        showError(d.error || "ลิงก์ใช้งานไม่ได้", d.reason === "expired");
        return;
      }
      render(d);
    })
    .catch(function () {
      showError("เชื่อมต่อไม่สำเร็จ กรุณาลองรีเฟรชหน้านี้อีกครั้ง", false);
    });

  function render(d) {
    $("[data-vk-dl-ref]").textContent = d.order_ref;
    $("[data-vk-dl-expires]").textContent = thaiDateTime(d.expires_at);
    $("[data-vk-dl-max]").textContent = d.max_downloads;

    var list = $("[data-vk-dl-list]");
    list.innerHTML = "";

    d.items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "vk-dl-item" + (it.released ? "" : " is-locked");

      var info = document.createElement("div");
      info.className = "vk-dl-info";
      var h = document.createElement("b");
      h.textContent = it.title;
      info.appendChild(h);

      var note = document.createElement("span");
      if (!it.released) {
        note.textContent = it.scheduled_delivery_date
          ? "จะส่งให้วันที่ " + thaiDate(it.scheduled_delivery_date)
          : "ยังไม่กำหนดวันส่ง";
      } else if (it.downloads_left <= 0) {
        note.textContent = "ดาวน์โหลดครบจำนวนแล้ว ทักไลน์มาได้เลยครับ";
      } else {
        note.textContent = "ดาวน์โหลดได้อีก " + it.downloads_left + " ครั้ง";
      }
      info.appendChild(note);
      row.appendChild(info);

      if (it.released && it.downloads_left > 0) {
        var a = document.createElement("a");
        a.className = "btn";
        a.href = "/api/download?token=" + encodeURIComponent(token) +
                 "&item=" + encodeURIComponent(it.id);
        a.textContent = "ดาวน์โหลด";
        a.setAttribute("aria-label", "ดาวน์โหลด " + it.title);
        row.appendChild(a);
      } else {
        var span = document.createElement("span");
        span.className = "vk-dl-badge";
        span.textContent = it.released ? "ครบจำนวน" : "ยังไม่ถึงกำหนด";
        row.appendChild(span);
      }

      list.appendChild(row);
    });

    $("[data-vk-dl-loading]").hidden = true;
    $("[data-vk-dl-main]").hidden = false;
  }

  /* ---------- ขอลิงก์ใหม่ ---------- */
  /* ส่งไปที่อีเมลเดิมของออเดอร์เท่านั้น ไม่ให้กรอกอีเมลใหม่
     ไม่งั้นใครขโมยลิงก์ไปก็เปลี่ยนปลายทางเป็นอีเมลตัวเองได้ */

  $$("[data-vk-dl-resend]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var msg = $("[data-vk-dl-resend-msg]");
      btn.disabled = true;
      var original = btn.textContent;
      btn.textContent = "กำลังส่ง…";

      fetch("/api/resend-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          btn.textContent = original;
          if (d.ok) {
            if (msg) msg.textContent = "ส่งลิงก์ใหม่ไปที่อีเมลที่ใช้สั่งซื้อแล้ว กรุณาตรวจกล่องจดหมายและโฟลเดอร์ junk ด้วยนะครับ";
            btn.hidden = true;
          } else {
            if (msg) msg.textContent = d.error || "ส่งไม่สำเร็จ กรุณาทักไลน์หาเรา";
            btn.disabled = false;
          }
        })
        .catch(function () {
          btn.textContent = original;
          btn.disabled = false;
          if (msg) msg.textContent = "ส่งไม่สำเร็จ กรุณาทักไลน์หาเรา";
        });
    });
  });
})();
