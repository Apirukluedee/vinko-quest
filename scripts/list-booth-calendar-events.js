/* ============================================================
   node scripts/list-booth-calendar-events.js

   ดึง event จาก Google Calendar ตารางออกบูธ (Calendar เดียวกับที่ Sky House
   ใช้ — พี่ใช้ calendar เดียวกันคุมทุกแบรนด์) แล้วพิมพ์รายการวันที่/สถานที่
   ออกมาให้ดู "เฉยๆ" ไม่ generate โค้ดอัตโนมัติ เพราะ event ในนี้ปนกันทั้ง
   VINKO และ Sky House — ต้องให้คนเลือกเองว่าอันไหนเป็นของ VINKO ก่อน
   (ดู scripts/gen-activation-rounds.js ต่อ หลังเลือกแล้ว)
   ============================================================ */
'use strict';

const CALENDAR_ID = '8e90647aa6b5b499c2a98fd63f4e493d8eca37e069ef16882b82b41cad726694@group.calendar.google.com';
const API_KEY = 'AIzaSyACeJg6brx-gSsR-Aep6XUKEAxhZnULTlE';

async function main() {
  const timeMin = new Date().toISOString();
  const url =
    'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(CALENDAR_ID) +
    '/events?key=' + API_KEY +
    '&singleEvents=true&orderBy=startTime&maxResults=50&timeMin=' + timeMin;

  // API key นี้ล็อก HTTP referrer ไว้ (ใช้จากเบราว์เซอร์ปกติ) — เรียกจาก Node
  // ตรงๆ จะโดนบล็อก 403 ต้องปลอม Referer ให้ตรงกับโดเมนที่อนุญาตไว้
  const r = await fetch(url, { headers: { Referer: 'https://skyhousepet.com/' } });
  if (!r.ok) {
    console.error('เรียก Calendar API ไม่สำเร็จ:', r.status, await r.text());
    process.exit(1);
  }
  const data = await r.json();
  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    console.log('ไม่มี event ล่วงหน้าใน Calendar เลย');
    return;
  }

  items.forEach((ev, i) => {
    const start = (ev.start && (ev.start.date || ev.start.dateTime)) || '?';
    const end = (ev.end && (ev.end.date || ev.end.dateTime)) || '?';
    console.log(
      '[' + i + '] ' + start + ' -> ' + end +
      '  |  ' + (ev.summary || '(ไม่มีชื่อ)') +
      (ev.location ? '  @ ' + ev.location : '')
    );
  });

  console.log('\nรวม ' + items.length + ' event — บอกเลขที่เป็นของ VINKO มาได้เลย');
}

main().catch(e => { console.error(e); process.exit(1); });
