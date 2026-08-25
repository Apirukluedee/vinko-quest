/* ============================================================
   VINKO — แบบสำรวจทักษะ EF ลูกวัย 5-7 ขวบ

   ทำงานฝั่ง browser ล้วน ไม่มี fetch ไม่มี storage ไม่มีอะไรถูกส่งออก
   เหมือนหน้า /certificate จึงไม่มีภาระ PDPA เพิ่ม

   กรอบที่ใช้คือ EF 9 ด้านที่ใช้กันทั่วไปในไทย แบ่งเป็น 3 กลุ่ม
   รายงานผลระดับ "กลุ่ม" (ด้านละ 2 ข้อ กลุ่มละ 6 ข้อ) เพราะ 2 ข้อ
   ต่อด้านน้อยเกินกว่าจะสรุปรายด้านได้อย่างซื่อสัตย์ แต่ยังบอกไว้ว่า
   แต่ละข้ออยู่ด้านไหน
   ============================================================ */
(function () {
  "use strict";

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var CHOICES = [
    { value: 2, label: "บ่อย" },
    { value: 1, label: "บางครั้ง" },
    { value: 0, label: "ยังไม่ค่อย" }
  ];

  var GROUPS = [
    {
      id: "basic",
      title: "ทักษะพื้นฐาน",
      sub: "จำ · ยั้งใจ · ยืดหยุ่น",
      skills: [
        {
          name: "จำเพื่อใช้งาน",
          questions: [
            "สั่งงานต่อกัน 2-3 อย่าง (เช่น เก็บรองเท้า ล้างมือ แล้วมานั่งโต๊ะ) ลูกทำได้ครบโดยไม่ต้องเตือนซ้ำ",
            "เล่าเรื่องที่เกิดขึ้นเมื่อวานหรือที่โรงเรียนได้เป็นลำดับ ไม่สลับไปมาจนฟังไม่รู้เรื่อง"
          ]
        },
        {
          name: "ยั้งคิดไตร่ตรอง",
          questions: [
            "เวลาอยากได้ของ ลูกรอจนถึงคิวตัวเองได้ ไม่คว้าทันที",
            "ตอนตื่นเต้นมาก ลูกยังฟังจนจบก่อนแล้วค่อยลงมือ"
          ]
        },
        {
          name: "ยืดหยุ่นความคิด",
          questions: [
            "ถ้าวิธีแรกไม่สำเร็จ ลูกลองเปลี่ยนวิธีใหม่เองได้ ไม่ล้มเลิกทันที",
            "แผนเปลี่ยนกะทันหัน (เช่น ฝนตกเลยไม่ได้ไปสนาม) ลูกปรับตัวได้ ไม่งอแงนาน"
          ]
        }
      ],
      strong: "ลูกจำสิ่งที่ต้องทำได้ ยั้งใจเป็น และเปลี่ยนวิธีได้เมื่อเจอทางตัน นี่คือฐานที่ดีมาก",
      grow: "สามด้านนี้เป็นฐานของอีกหกด้านที่เหลือ ตอนนี้ยังกำลังก่อตัว ซึ่งปกติมากสำหรับวัยนี้ ฝึกได้ด้วยกิจกรรมสั้นๆ ที่มีขั้นตอนชัดเจน",
      tips: [
        "สั่งงานทีละ 2 ขั้นแล้วให้ลูก<b>ทวนกลับ</b>ก่อนลงมือ (หนูจะทำอะไรก่อน แล้วอะไรต่อ?) การทวนคือการฝึกความจำใช้งานโดยตรง",
        "เล่นเกมที่ต้องยั้งใจ เช่น ไฟแดง-ไฟเขียว หรือปรบมือตามจังหวะแล้วสลับกติกากลางคัน ได้ทั้งยั้งใจและความยืดหยุ่นพร้อมกัน",
        "เวลาลูกติด อย่ารีบบอกคำตอบ ถามว่า ลองวิธีอื่นได้ไหม แล้วรอสัก 10 วินาที"
      ],
      missions: "ในเล่ม VINKO WOW LAB ภารกิจที่ 2 (ลูกโป่งพองเองได้?!) พังทันทีถ้าสลับขั้นตอน จึงบังคับให้ทำทีละขั้นจนครบ · ภารกิจที่ 3 (พริกไทยหนีน้ำ!) ให้จิ้มนิ้วเปล่าก่อนแล้วค่อยจิ้มนิ้วมีสบู่ ฝึกเปลี่ยนทีละตัวแปรเพื่อหาว่าอะไรคือตัวทำ"
    },
    {
      id: "regulate",
      title: "กำกับตัวเอง",
      sub: "จดจ่อ · คุมอารมณ์ · รู้ตัว",
      skills: [
        {
          name: "จดจ่อใส่ใจ",
          questions: [
            "ทำกิจกรรมที่ชอบได้ต่อเนื่อง 10-15 นาที โดยไม่ลุกไปทำอย่างอื่น",
            "ถูกขัดจังหวะแล้วกลับมาทำสิ่งที่ค้างไว้ต่อได้เอง"
          ]
        },
        {
          name: "ควบคุมอารมณ์",
          questions: [
            "เวลาผิดหวังหรือแพ้ ลูกสงบลงได้เองภายในไม่กี่นาที",
            "โกรธแล้วบอกเป็นคำพูดได้ว่าโกรธอะไร แทนการตี ขว้างของ หรือกรีดร้อง"
          ]
        },
        {
          name: "ติดตามประเมินตนเอง",
          questions: [
            "ลูกรู้ตัวว่าทำอะไรพลาด โดยที่เรายังไม่ได้บอก",
            "ระหว่างทำงาน ลูกถามหรือบอกได้ว่า แบบนี้ดีขึ้นไหม หรือ ทำผิดตรงนี้แล้ว"
          ]
        }
      ],
      strong: "ลูกอยู่กับสิ่งตรงหน้าได้นาน กลับมาจากอารมณ์เสียได้เอง และรู้ตัวว่ากำลังทำอะไรอยู่",
      grow: "การกำกับตัวเองเป็นด้านที่โตช้าที่สุดในบรรดา EF ทั้งหมด และไวต่อการนอนไม่พอกับเวลาหน้าจอเป็นพิเศษ ลองดูสองเรื่องนี้ควบคู่ไปด้วย",
      tips: [
        "ตั้งเวลา 10 นาทีแล้วทำกิจกรรมเดียวจนหมดเวลา (ต่อบล็อก ระบายสี) ค่อยๆ ขยับเป็น 15 นาที ฝึกจดจ่อแบบมีขอบเขตชัด",
        "ตอนลูกอารมณ์เสีย <b>ตั้งชื่ออารมณ์ให้ก่อน</b> (หนูกำลังโมโหที่บล็อกล้มใช่ไหม) การมีคำเรียกช่วยให้เด็กคุมอารมณ์ได้เร็วขึ้นจริง",
        "หลังทำอะไรเสร็จ ถามสองคำถามสั้นๆ ตรงไหนที่ทำได้ดี และ ครั้งหน้าจะเปลี่ยนอะไร ฝึกการประเมินตัวเอง"
      ],
      missions: "ในเล่ม ภารกิจที่ 1 (ภูเขาไฟโซดาระเบิด!) ต้องเทเบกกิ้งโซดาหลังเตรียมทุกอย่างเสร็จเท่านั้น ตื่นเต้นได้เต็มที่แต่ยังต้องรอ · ภารกิจที่ 7 (น้ำเดินได้!) ให้ตั้งเวลากลับมาดูทุก 10 นาที ฝึกรอแบบมีแผน · ภารกิจที่ 9 (จรวดลูกโป่ง) ครั้งแรกมักตกกลางทาง ฝึกไม่โกรธแล้วแก้ใหม่"
    },
    {
      id: "execute",
      title: "ลงมือทำจนสำเร็จ",
      sub: "เริ่มเอง · วางแผน · ไปให้ถึง",
      skills: [
        {
          name: "ริเริ่มลงมือทำ",
          questions: [
            "เริ่มงานที่ได้รับมอบหมายได้เอง ไม่ต้องบอกซ้ำหลายรอบ",
            "เวลาว่าง ลูกคิดกิจกรรมเล่นเองได้ ไม่ต้องรอให้ผู้ใหญ่หาให้"
          ]
        },
        {
          name: "วางแผนจัดระบบ",
          questions: [
            "ก่อนเริ่มทำอะไร ลูกเตรียมของที่ต้องใช้ให้ครบก่อนได้",
            "เก็บของเข้าที่เดิมได้เองหลังเล่นเสร็จ"
          ]
        },
        {
          name: "มุ่งเป้าหมาย",
          questions: [
            "งานที่ยากขึ้นหน่อย ลูกยังทำต่อจนเสร็จ ไม่ทิ้งกลางคัน",
            "ถ้าอยากได้อะไรสักอย่าง ลูกยอมทำตามเงื่อนไขที่ตกลงกันไว้จนครบ"
          ]
        }
      ],
      strong: "ลูกเริ่มเองได้ เตรียมของเป็น และไปจนจบ นี่คือชุดทักษะที่จะติดตัวไปถึงห้องเรียนและที่ทำงาน",
      grow: "เด็กวัยนี้ส่วนใหญ่ยังต้องการผู้ใหญ่ช่วยตั้งต้นให้ ค่อยๆ ถอยออกทีละขั้นจะได้ผลกว่าปล่อยทันที",
      tips: [
        "ให้ลูก<b>เตรียมของเอง</b>ก่อนเริ่มกิจกรรม โดยเราบอกแค่รายการ ไม่ต้องหยิบให้ การเตรียมของคือการวางแผนในรูปแบบที่เด็กจับต้องได้",
        "งานที่ยาว ให้ซอยเป็น 3 ขั้นแล้วให้ลูกขีดออกทีละขั้น เห็นความคืบหน้าแล้วจะไปต่อได้เอง",
        "ตกลงเงื่อนไขล่วงหน้าและ<b>รักษาตามที่ตกลง</b>ทุกครั้ง ความสม่ำเสมอของผู้ใหญ่คือสิ่งที่สอนเรื่องมุ่งเป้าหมายได้ดีที่สุด"
      ],
      missions: "ในเล่ม ภารกิจที่ 9 (จรวดลูกโป่งพุ่งข้ามห้อง!) ต้องขึงเชือก ติดเทป เป่าลูกโป่งให้ครบก่อนปล่อย ฝึกเรียงลำดับงานหลายขั้น · ภารกิจที่ 6 (ถุงน้ำทะลุแต่ไม่รั่ว!) ต้องแทงเร็วและมั่นใจในครั้งเดียว ฝึกตัดสินใจแล้วลงมือ · ภารกิจที่ 10 ต้องทายให้ครบทุกชิ้นก่อนเริ่ม"
    }
  ];

  /* แผ่ 9 ด้านออกเป็น 18 ข้อ เรียงตามกลุ่ม */
  var ITEMS = [];
  GROUPS.forEach(function (g) {
    g.skills.forEach(function (s) {
      s.questions.forEach(function (q) {
        ITEMS.push({ group: g.id, skill: s.name, text: q });
      });
    });
  });

  var MAX_PER_GROUP = 12;   // 6 ข้อ x 2 คะแนน

  var BAND = {
    strong:   { label: "แข็งแรงแล้ว", cls: "is-strong" },
    growing:  { label: "กำลังก่อตัว", cls: "is-growing" },
    practice: { label: "ควรฝึกเพิ่ม", cls: "is-practice" }
  };

  function bandOf(score) {
    if (score >= 9) return "strong";
    if (score >= 5) return "growing";
    return "practice";
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- สร้างคำถาม ---------- */

  function renderQuestions() {
    var html = "";
    var n = 0;
    GROUPS.forEach(function (g) {
      html += '<div class="vk-ef-group-head"><h2>' + esc(g.title) + "</h2>" +
              "<p>" + esc(g.sub) + "</p></div>";
      g.skills.forEach(function (s) {
        s.questions.forEach(function (q) {
          n += 1;
          var name = "q" + n;
          /* ห้ามใช้ fieldset + legend ตรงนี้ — Safari บน iOS ไม่นับความสูง
             ของ legend เข้าในกล่องของ fieldset ข้อความคำถามจะล้นไปทับปุ่ม
             ตอบข้างล่าง (เจอจริงบนมือถือลูกค้า บนคอมไม่เห็นปัญหา)
             ใช้ div + role="group" + aria-labelledby แทน ได้ผลเหมือนกัน
             สำหรับ screen reader และวางตำแหน่งตรงทุกเบราว์เซอร์ */
          html += '<div class="vk-ef-q" role="group" data-vk-ef-q="' + n +
                  '" aria-labelledby="' + name + '-label">' +
                  '<p class="vk-ef-qtext" id="' + name + '-label">' +
                  '<span class="vk-ef-no">' + n + "</span>" + esc(q) +
                  '<small class="vk-ef-skill">' + esc(s.name) + "</small></p>" +
                  '<div class="vk-ef-choices">';
          CHOICES.forEach(function (c) {
            var id = name + "-" + c.value;
            html += '<input type="radio" id="' + id + '" name="' + name + '" value="' + c.value + '"/>' +
                    '<label for="' + id + '">' + esc(c.label) + "</label>";
          });
          html += "</div></div>";
        });
      });
    });
    $("#vk-ef-questions").innerHTML = html;
  }

  /* ---------- อ่านคำตอบ ---------- */

  function readAnswers() {
    return ITEMS.map(function (_, i) {
      var picked = $('input[name="q' + (i + 1) + '"]:checked');
      return picked ? Number(picked.value) : null;
    });
  }

  function updateProgress() {
    var answers = readAnswers();
    var done = answers.filter(function (a) { return a !== null; }).length;
    $("[data-vk-ef-progress]").textContent = "ตอบแล้ว " + done + " จาก " + ITEMS.length + " ข้อ";
    return answers;
  }

  /* ---------- แสดงผล ---------- */

  function meter(score) {
    var pct = Math.round(score / MAX_PER_GROUP * 100);
    return '<div class="vk-ef-meter" role="img" aria-label="คะแนน ' + score +
           " จาก " + MAX_PER_GROUP + '"><span style="width:' + pct + '%"></span></div>';
  }

  function renderResult(answers) {
    var total = 0;
    var out = "";

    GROUPS.forEach(function (g) {
      var score = 0;
      ITEMS.forEach(function (it, i) {
        if (it.group === g.id) score += answers[i];
      });
      total += score;

      var band = bandOf(score);
      var b = BAND[band];

      out += '<article class="vk-ef-card ' + b.cls + '">' +
             "<header><div><h3>" + esc(g.title) + "</h3><p>" + esc(g.sub) + "</p></div>" +
             '<span class="vk-ef-badge">' + esc(b.label) + "</span></header>" +
             '<p class="vk-ef-score">' + score + " / " + MAX_PER_GROUP + " คะแนน</p>" +
             meter(score) +
             '<p class="vk-ef-verdict">' + (band === "strong" ? g.strong : g.grow) + "</p>";

      if (band !== "strong") {
        out += '<p class="vk-ef-tip-head">ฝึกที่บ้านได้เลย</p><ul class="vk-ef-tips">';
        g.tips.forEach(function (t) { out += "<li>" + t + "</li>"; });
        out += "</ul>";
      }

      out += '<p class="vk-ef-mission">' + g.missions + "</p>" +
             '<p class="vk-ef-skills">ครอบคลุม: ' +
             g.skills.map(function (s) { return esc(s.name); }).join(" · ") + "</p>" +
             "</article>";
    });

    $("[data-vk-ef-groups]").innerHTML = out;

    var max = MAX_PER_GROUP * GROUPS.length;
    var headline;
    if (total >= max * 0.75)      headline = "EF ของลูกอยู่ในเกณฑ์ที่แข็งแรงสำหรับวัยนี้";
    else if (total >= max * 0.45) headline = "EF ของลูกกำลังก่อตัว มีทั้งด้านที่แข็งและด้านที่ควรเติม";
    else                          headline = "EF ของลูกยังต้องการการฝึกอีกหลายด้าน ซึ่งเป็นเรื่องปกติของวัยนี้";

    $("[data-vk-ef-headline]").textContent = headline;
    $("[data-vk-ef-total]").textContent = "คะแนนรวม " + total + " จาก " + max +
      " · เช็กเมื่อ " + new Date().toLocaleDateString("th-TH", {
        day: "numeric", month: "long", year: "numeric"
      });
  }

  /* ---------- ผูกเหตุการณ์ ---------- */

  renderQuestions();
  updateProgress();

  var form   = $("#vk-ef-form");
  var result = $("[data-vk-ef-result]");
  var errBox = $("[data-vk-ef-error]");

  form.addEventListener("change", function () {
    updateProgress();
    errBox.textContent = "";
    $$(".vk-ef-q.is-missing").forEach(function (el) { el.classList.remove("is-missing"); });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var answers = updateProgress();
    var missing = [];
    answers.forEach(function (a, i) { if (a === null) missing.push(i + 1); });

    if (missing.length) {
      errBox.textContent = "ยังไม่ได้ตอบอีก " + missing.length + " ข้อ (ข้อ " +
        missing.slice(0, 6).join(", ") + (missing.length > 6 ? " …" : "") + ")";
      missing.forEach(function (n) {
        var el = $('[data-vk-ef-q="' + n + '"]');
        if (el) el.classList.add("is-missing");
      });
      var first = $('[data-vk-ef-q="' + missing[0] + '"]');
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    renderResult(answers);
    form.hidden = true;
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* เบราว์เซอร์ในแอป (LINE / Facebook) เรียก window.print() แล้วไม่เกิดอะไรขึ้น
     เงียบสนิท ลูกค้าจะคิดว่าปุ่มเสีย ต้องบอกให้เปิดในเบราว์เซอร์จริงก่อน
     ลิงก์นี้ส่งทาง LINE เกือบทั้งหมด เคสนี้จึงเป็นเคสปกติ ไม่ใช่เคสหายาก */
  function inAppBrowser() {
    return /Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger/i.test(navigator.userAgent || "");
  }

  var printBtn = $("[data-vk-ef-print]");
  var printMsg = $("[data-vk-ef-print-msg]");

  printBtn.addEventListener("click", function () {
    if (inAppBrowser()) {
      printMsg.textContent = "กำลังเปิดในแอปอยู่ จึงสั่งพิมพ์ไม่ได้ — กดปุ่ม ⋯ มุมขวาบน " +
        "แล้วเลือก “เปิดในเบราว์เซอร์” จากนั้นทำแบบสำรวจใหม่แล้วกดปุ่มนี้อีกครั้ง " +
        "หรือจะแคปหน้าจอเก็บไว้เลยก็ได้";
      printMsg.hidden = false;
      return;
    }
    try {
      window.print();
    } catch (e) {
      printMsg.textContent = "เบราว์เซอร์นี้สั่งพิมพ์ไม่ได้ แคปหน้าจอเก็บไว้แทนได้เลยครับ";
      printMsg.hidden = false;
    }
  });

  $("[data-vk-ef-again]").addEventListener("click", function () {
    form.reset();
    updateProgress();
    result.hidden = true;
    form.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
