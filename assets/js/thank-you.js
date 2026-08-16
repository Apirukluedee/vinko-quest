/* ============================================================
   VINKO — หน้า /thank-you
   ขอลิงก์ดาวน์โหลดมาแสดงทันที ไม่ให้ลูกค้าต้องนั่งรออีเมล
   อีเมลอาจช้าหรือเข้า junk และลูกค้าที่จ่ายเงินแล้วไม่ได้ของทันที
   คือลูกค้าที่กำลังจะทักมาถาม
   ============================================================ */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var loading = $("[data-vk-ty-loading]");
  if (!loading) return;

  var ready = $("[data-vk-ty-ready]");
  var fallback = $("[data-vk-ty-email]");

  function showEmailOnly() {
    loading.hidden = true;
    ready.hidden = true;
    fallback.hidden = false;
  }

  // ref มาจาก query string ส่วน rid เป็นค่าสุ่มที่เบราว์เซอร์นี้สร้างตอนกดจ่าย
  var ref = new URLSearchParams(window.location.search).get("ref") || "";
  var saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("vinko_last_order") || "null"); } catch (e) {}

  var rid = saved && saved.rid;
  if (!ref && saved) ref = saved.ref;

  // ไม่มีข้อมูลยืนยัน (เช่น เปิดหน้านี้จากเครื่องอื่น) ให้ใช้ลิงก์จากอีเมลแทน
  if (!ref || !rid || (saved && saved.ref && saved.ref !== ref)) {
    showEmailOnly();
    return;
  }

  var tries = 0;

  function ask() {
    tries++;
    fetch("/api/claim-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_ref: ref, client_request_id: rid })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.ready) {
          $("[data-vk-ty-link]").href = d.download_url;
          var exp = $("[data-vk-ty-expires]");
          if (exp && d.expires_at) {
            exp.textContent = new Date(d.expires_at).toLocaleString("th-TH", {
              day: "numeric", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok"
            }) + " น.";
          }
          loading.hidden = true;
          ready.hidden = false;
          return;
        }
        // webhook อาจยังทำงานไม่เสร็จ ลองใหม่ได้ถึง ~30 วินาที
        if (tries < 10) setTimeout(ask, 3000);
        else showEmailOnly();
      })
      .catch(function () {
        if (tries < 10) setTimeout(ask, 3000);
        else showEmailOnly();
      });
  }

  ask();
})();
