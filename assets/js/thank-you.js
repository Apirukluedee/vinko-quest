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

  /* ---------- ส่ง purchase เข้า GA4 ----------

     ยอดเงินและแพ็กเกจมาจาก /api/claim-download เท่านั้น (ฝั่ง server ยืนยัน paid แล้ว)
     ไม่อ่านจาก URL หรือ sessionStorage เพราะผู้ใช้แก้ได้

     กันซ้ำสองชั้น: transaction_id ฝั่ง GA4 + ธงฝั่งเบราว์เซอร์
     เพราะ sessionStorage.vinko_last_order ยังอยู่ตลอดอายุแท็บ
     ลูกค้ากดรีเฟรชหน้านี้ = เรียก claim-download ใหม่ = ยิงซ้ำได้

     ธงแปลว่า "เรียกส่งไปแล้ว" ไม่ใช่ "GA4 รับสำเร็จแล้ว"                      */

  var pendingPurchase = null;
  var sentInPage = {};

  function sentKey(ref) { return "vinko_ga_purchase_sent:" + ref; }
  function alreadySent(ref) {
    if (sentInPage[ref]) return true;
    try { return localStorage.getItem(sentKey(ref)) === "1"; } catch (e) { return false; }
  }
  function markSent(ref) {
    sentInPage[ref] = true;
    try { localStorage.setItem(sentKey(ref), "1"); } catch (e) {}
  }

  function sendPurchase(p) {
    if (!p || !p.transaction_id) return;
    pendingPurchase = p;
    if (alreadySent(p.transaction_id)) return;

    var V = window.VINKO;
    if (!V || typeof V.track !== "function") return;

    // ยังไม่ยอมรับคุกกี้ = ยังส่งไม่ได้ เก็บไว้รอ ไม่ตั้งธง
    var ok = V.track("purchase", {
      transaction_id: p.transaction_id,
      value: p.value,
      currency: p.currency || "THB",
      payment_mode: p.payment_mode,
      items: [{
        item_id: p.item_id,
        item_name: p.item_name,
        price: p.value,
        quantity: 1
      }]
    });

    if (ok) { markSent(p.transaction_id); pendingPurchase = null; }
    else { pendingPurchase = p; }
  }

  // ยอมรับคุกกี้ทีหลังขณะยังอยู่หน้านี้ ต้องได้ส่ง ไม่ต้องให้รีเฟรช
  window.addEventListener("vinko:consent-granted", function () {
    if (pendingPurchase) sendPurchase(pendingPurchase);
  });
  window.addEventListener("vinko:analytics-ready", function () {
    if (pendingPurchase) sendPurchase(pendingPurchase);
  });

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

  // โชว์เลขที่คำสั่งซื้อทันทีที่รู้ ก่อนแตกสาขาใดๆ
  // เลขนี้เคยไม่ถูกแสดงที่ไหนเลยนอกจากในอีเมล ลูกค้าที่ไม่ได้รับอีเมลจึงเข้า
  // /resend-link ไม่ได้ กลายเป็นวงกลม — ต้องเห็นตรงนี้ให้จดไว้ได้ก่อน
  // และต้องโชว์แม้ในสาขา showEmailOnly() ด้วย เพราะคนที่เปิดจากเครื่องอื่น
  // คือคนที่ต้องใช้เลขนี้มากที่สุด
  if (ref) {
    var refBox = $("[data-vk-ty-ref-box]");
    var refVal = $("[data-vk-ty-ref]");
    if (refBox && refVal) {
      refVal.textContent = ref;
      refBox.hidden = false;
    }
  }

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

          // ยิง analytics หลังลูกค้าเห็นลิงก์แล้วเท่านั้น และห้ามให้ error
          // ของ analytics ไปขวางการรับไฟล์ของคนที่จ่ายเงินมาแล้ว
          try { sendPurchase(d.purchase); } catch (e) {}
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
