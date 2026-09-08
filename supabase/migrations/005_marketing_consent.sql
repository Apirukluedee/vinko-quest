-- 005_marketing_consent.sql
-- ความยินยอมรับอีเมลการตลาด (PDPA)
--
-- ทำไมเก็บเป็น timestamptz ไม่ใช่ boolean
--   PDPA ต้องพิสูจน์ได้ว่าเจ้าของข้อมูล "ยินยอมเมื่อไหร่" ไม่ใช่แค่ "ยินยอมไหม"
--   ถ้าถูกร้องเรียนหรือถูกตรวจสอบ ต้องตอบให้ได้ว่าได้มาวันไหน จากช่องทางไหน
--
-- null = ไม่ยินยอม = ห้ามส่งอีเมลการตลาดหาคนนี้เด็ดขาด
-- ความยินยอมนี้แยกจาก consent_terms_at และ consent_privacy_at โดยสิ้นเชิง
-- คนที่ซื้อของแล้วไม่ติ๊กช่องนี้ ยังต้องได้รับอีเมลลิงก์ดาวน์โหลดตามปกติ
-- เพราะนั่นคือการส่งมอบสินค้าที่เขาจ่ายเงินแล้ว ไม่ใช่การตลาด

alter table orders
  add column if not exists consent_marketing_at timestamptz,
  add column if not exists marketing_optout_at  timestamptz;

comment on column orders.consent_marketing_at is
  'เวลาที่ลูกค้าติ๊กยินยอมรับอีเมลการตลาด (null = ไม่ยินยอม ห้ามส่ง)';
comment on column orders.marketing_optout_at is
  'เวลาที่ลูกค้ากดยกเลิกรับข่าวสาร มีค่าเมื่อไหร่ = ห้ามส่งทันที แม้เคยยินยอมมาก่อน';

-- ดัชนีสำหรับดึงรายชื่อที่ส่งได้จริง: ยินยอมแล้วและยังไม่ได้ยกเลิก
create index if not exists orders_marketing_ok_idx
  on orders (consent_marketing_at)
  where consent_marketing_at is not null and marketing_optout_at is null;
