-- 006_unsubscribe_token.sql
-- token สำหรับลิงก์ "ยกเลิกรับอีเมลการตลาด" ที่ต้องฝังในทุกอีเมลการตลาด (PDPA)
--
-- ทำไมต้องแยกจาก download_token โดยเจตนา
--   download_token เปิดไฟล์ที่ลูกค้าจ่ายเงินแล้วได้ ถ้าเอามาใช้ซ้ำเป็นลิงก์ยกเลิก
--   ใครก็ตามที่มี download_token (ซึ่งอาจหลุดผ่านแชร์สกรีนช็อต/ฟอร์เวิร์ดอีเมล)
--   จะกดยกเลิกรับข่าวสารแทนเจ้าของได้ด้วย — เป็นคนละสิทธิ์ คนละคีย์
--
--   token นี้ทำได้อย่างเดียวคือ "ปิดการตลาด" ของออเดอร์นั้น ไม่เปิดไฟล์อะไรทั้งสิ้น
--   จึงฝังลงอีเมล/ลิงก์สาธารณะได้อย่างปลอดภัยกว่า

alter table orders
  add column if not exists unsubscribe_token text;

-- unique เฉพาะแถวที่มีค่า (ออเดอร์เก่าก่อน migration นี้ยังเป็น null ได้ ไม่ชน)
create unique index if not exists orders_unsubscribe_token_idx
  on orders (unsubscribe_token)
  where unsubscribe_token is not null;

comment on column orders.unsubscribe_token is
  'token แยกจาก download_token — ใช้ทำได้แค่กดยกเลิกรับอีเมลการตลาด (ตั้ง marketing_optout_at)';
