-- ============================================================
-- 004 — เปิดให้ขายแพ็กเกจ STORIES ได้
--
-- ปัญหา: หน้า /checkout เสนอแพ็กเกจ STORIES (299 บาท) ให้ลูกค้าเลือก
--        และ api/_lib/catalog.js มีราคาไว้ครบ
--        แต่ constraint ในฐานข้อมูลอนุญาตแค่ LAB กับ BUNDLE
--        ลูกค้าที่เลือก Stories แล้วกดจ่าย -> insert ถูกปฏิเสธ -> ซื้อไม่ได้
--
-- ตรวจสอบจากฐานข้อมูลจริงเมื่อ 2026-09-05 ยืนยันว่ายังเป็นแบบนี้อยู่:
--        orders_package_code_check
--        CHECK ((package_code = ANY (ARRAY['LAB'::text, 'BUNDLE'::text])))
--
-- migration นี้ไม่แตะข้อมูลเดิม เพิ่มค่าที่อนุญาตอย่างเดียว
-- ออเดอร์ LAB และ BUNDLE ที่มีอยู่ยังผ่าน constraint ใหม่ทั้งหมด
--
-- ห้ามรันพร้อมกับการ deploy งาน tracking
-- นี่เป็นการแก้บั๊กคนละเรื่อง ต้องขออนุมัติแยกและรันแยก
-- ============================================================

begin;

alter table public.orders
  drop constraint if exists orders_package_code_check;

alter table public.orders
  add constraint orders_package_code_check
  check (package_code in ('LAB', 'STORIES', 'BUNDLE'));

commit;

-- ตรวจหลังรัน: ต้องเห็น STORIES อยู่ในนิยาม
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'orders_package_code_check';
--
-- ผลที่ต้องได้:
--   CHECK ((package_code = ANY (ARRAY['LAB'::text, 'STORIES'::text, 'BUNDLE'::text])))
