-- ============================================================
-- คืนเงิน — เก็บหลักฐานและตัดสิทธิ์ดาวน์โหลด
--
-- ก่อนหน้านี้ status มีค่า 'refunded' อยู่ในสคีมาแล้ว แต่ไม่มีอะไรเซ็ตมันเลย
-- ถ้าเจ้าของกดคืนเงินใน Omise ฝั่งเรายังเป็น paid อยู่ ลูกค้าจึงโหลดไฟล์
-- ต่อได้จนกว่า token จะหมดอายุ 48 ชม. ตารางนี้ปิดช่องนั้น
--
-- คืนบางส่วนได้ด้วย (เช่นแพ็กเกจ BUNDLE คืนเฉพาะนิทานที่ยังไม่ส่ง ตามข้อ 4.4
-- ของหน้า /terms) จึงต้องมี refunded_at ที่ระดับ order_items ไม่ใช่แค่ orders
-- ============================================================

alter table orders
  add column if not exists refunded_at    timestamptz,
  add column if not exists refund_satang  integer,
  add column if not exists refund_note    text;

comment on column orders.refunded_at   is 'เวลาที่บันทึกการคืนเงิน (ยืนยันกับ Omise แล้ว)';
comment on column orders.refund_satang is 'ยอดที่คืนจริง หน่วยสตางค์ ดึงมาจาก Omise ไม่ได้กรอกเอง';
comment on column orders.refund_note   is 'เหตุผลที่คืน สำหรับดูย้อนหลัง';

-- คืนเฉพาะบางรายการ: รายการที่ถูกคืนจะโหลดไม่ได้ และ cron จะไม่ส่งให้อีก
alter table order_items
  add column if not exists refunded_at timestamptz;

comment on column order_items.refunded_at is 'คืนเงินรายการนี้แล้ว ห้ามส่งและห้ามให้โหลด';

-- cron หยิบงานด้วย delivery_type + delivered_at อยู่แล้ว เพิ่ม refunded_at
-- เข้าไปในดัชนีเดิมเพื่อให้เงื่อนไข "ยังไม่ถูกคืน" ไม่ต้องสแกนทั้งตาราง
create index if not exists order_items_pending_delivery_idx
  on order_items (scheduled_delivery_date)
  where delivery_type = 'preorder' and delivered_at is null and refunded_at is null;
