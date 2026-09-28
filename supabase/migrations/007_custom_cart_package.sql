-- ============================================================
-- 007 — เปิดให้ซื้อแยกเล่มจากหน้า /books ได้ (package_code = 'CUSTOM')
--
-- ปัญหา: หน้า /books ให้ลูกค้าเลือกซื้อทีละเล่ม api/create-charge.js
--        บันทึกออเดอร์แบบนี้เป็น package_code = 'CUSTOM'
--        แต่ constraint ในฐานข้อมูลอนุญาตแค่ LAB / STORIES / BUNDLE
--        -> insert ถูกปฏิเสธ -> ลูกค้าเห็น "ไม่สามารถบันทึกคำสั่งซื้อได้"
--        ทั้งบัตรและ PromptPay (พังก่อนถึง Omise)
--
-- ยืนยันจาก log production 2026-09-28 (VK-2609-0004/0005/0006):
--   23514 new row for relation "orders" violates check constraint
--   "orders_package_code_check"
--
-- migration นี้ไม่แตะข้อมูลเดิม เพิ่มค่าที่อนุญาตอย่างเดียว
-- ออเดอร์ LAB / STORIES / BUNDLE ที่มีอยู่ยังผ่าน constraint ใหม่ทั้งหมด
-- ============================================================

begin;

alter table public.orders
  drop constraint if exists orders_package_code_check;

alter table public.orders
  add constraint orders_package_code_check
  check (package_code in ('LAB', 'STORIES', 'BUNDLE', 'CUSTOM'));

commit;

-- ตรวจหลังรัน: ต้องเห็น CUSTOM อยู่ในนิยาม
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'orders_package_code_check';
--
-- ผลที่ต้องได้:
--   CHECK ((package_code = ANY (ARRAY['LAB'::text, 'STORIES'::text, 'BUNDLE'::text, 'CUSTOM'::text])))
