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

  /* ธงแยกกันต่อปลายทาง (GA4 / Meta) เพราะพร้อมไม่พร้อมกัน
     เช่น GA4 โหลดช้ากว่า fbq หรือ Meta ไม่ยิงบน localhost เลย */
  function sentKey(dest, ref) { return "vinko_" + dest + "_purchase_sent:" + ref; }
  function alreadySent(dest, ref) {
    if (sentInPage[dest + ref]) return true;
    try { return localStorage.getItem(sentKey(dest, ref)) === "1"; } catch (e) { return false; }
  }
  function markSent(dest, ref) {
    sentInPage[dest + ref] = true;
    try { localStorage.setItem(sentKey(dest, ref), "1"); } catch (e) {}
  }

  function sendPurchase(p) {
    if (!p || !p.transaction_id) return;
    pendingPurchase = p;

    var V = window.VINKO;
    if (!V || typeof V.track !== "function") return;
    var ref = p.transaction_id;
    // server ส่ง items มาเสมอ (ตะกร้า /books มีหลายเล่ม) — ตัวสำรองรองรับ response รูปแบบเก่า
    var items = Array.isArray(p.items) && p.items.length ? p.items : [{
      item_id: p.item_id,
      item_name: p.item_name,
      price: p.value,
      quantity: 1
    }];

    // ยังไม่ยอมรับคุกกี้ = ยังส่งไม่ได้ เก็บไว้รอ ไม่ตั้งธง
    if (!alreadySent("ga", ref) && V.track("purchase", {
      transaction_id: ref,
      value: p.value,
      currency: p.currency || "THB",
      payment_mode: p.payment_mode,
      items: items
    })) markSent("ga", ref);

    // Meta: eventID = order_ref ตัวเดียวกับที่ server ส่งผ่าน Conversions API
    // Meta จึงนับสองฝั่งเป็น purchase เดียว
    if (!alreadySent("meta", ref) && typeof V.metaTrack === "function" && V.metaTrack("Purchase", {
      value: p.value,
      currency: p.currency || "THB",
      content_ids: items.map(function (i) { return i.item_id; }),
      content_type: "product",
      num_items: items.length,
      payment_mode: p.payment_mode
    }, ref)) markSent("meta", ref);

    if (alreadySent("ga", ref) && alreadySent("meta", ref)) pendingPurchase = null;
  }

  // ยอมรับคุกกี้ทีหลังขณะยังอยู่หน้านี้ ต้องได้ส่ง ไม่ต้องให้รีเฟรช
  window.addEventListener("vinko:consent-granted", function () {
    if (pendingPurchase) sendPurchase(pendingPurchase);
  });
  window.addEventListener("vinko:analytics-ready", function () {
    if (pendingPurchase) sendPurchase(pendingPurchase);
  });

  function showLineConnect(d) {
    var box = $("[data-vk-ty-line]");
    if (!box || !d.connect_line_url || !d.connect_line_qr_svg) return;
    $("[data-vk-ty-line-qr]").innerHTML = d.connect_line_qr_svg;
    box.hidden = false;

    var btn = $("[data-vk-ty-line-copy]");
    var label = btn.textContent;
    function showRawLink() {
      if (box.querySelector(".ty-line-connect-fallback")) return;
      var input = document.createElement("input");
      input.className = "ty-line-connect-fallback";
      input.readOnly = true;
      input.value = d.connect_line_url;
      btn.parentNode.insertBefore(input, btn.nextSibling);
      input.focus();
      input.select();
    }
    btn.addEventListener("click", function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { showRawLink(); return; }
      navigator.clipboard.writeText(d.connect_line_url).then(function () {
        btn.textContent = "คัดลอกแล้ว ✓ ไปวางในแชท LINE ได้เลย";
        setTimeout(function () { btn.textContent = label; }, 3000);
      }).catch(showRawLink);
    });
  }

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
          try { showLineConnect(d); } catch (e) {}

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
