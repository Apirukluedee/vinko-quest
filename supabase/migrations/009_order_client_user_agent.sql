-- ============================================================
-- 009 — เก็บข้อมูลเบราว์เซอร์ (user agent) ของออเดอร์ สำหรับ Meta Conversions API
--
-- ที่มา: Meta กำหนดว่า Purchase ที่ส่งจากเซิร์ฟเวอร์แบบ action_source = website
--        ต้องมี user_data.client_user_agent ("required for website events")
--        แต่ตอนจ่ายเงินผ่าน PromptPay การแจ้งผลมาจาก Omise (webhook)
--        ไม่มี user agent ของลูกค้า -> ต้องเก็บไว้ตั้งแต่ตอนกดสั่งซื้อ
--
-- สิ่งที่เพิ่ม (additive ล้วน ไม่แตะข้อมูลเดิม ไม่ backfill):
--   orders.client_user_agent  text  NULL  ยาวไม่เกิน 512 ตัวอักษร
--
-- เก็บเฉพาะออเดอร์ที่ attribution_status = 'captured' เท่านั้น (ตรวจในโค้ด create-charge)
--   = ลูกค้ายอมรับคุกกี้ และเป็นออเดอร์ที่ CAPI จะส่งจริง
--   ออเดอร์อื่น (none / no_consent) เป็น NULL เสมอ เพราะไม่มีที่ใช้
--
-- ลบตามคำขอลูกค้า (PDPA) — ลบพร้อม attribution ได้ในคำสั่งเดียว:
--   update public.orders
--      set attribution_snapshot = null,
--          attribution_status   = 'erased',
--          client_user_agent    = null
--    where order_ref = 'VK-....';
--   (trigger write-once ของ 008 ดูแค่สองคอลัมน์ attribution ไม่กันคอลัมน์นี้)
--
-- ลำดับ deploy: รันไฟล์นี้บน production ก่อน แล้วค่อย merge โค้ด
-- ถ้าลืม: create-charge จะลองบันทึกใหม่โดยไม่มีคอลัมน์นี้ (log CLIENT_UA_COLUMN_MISSING)
--         การขายไม่พัง แต่ CAPI จะไม่ได้ user agent จนกว่าจะรัน
-- รันซ้ำได้ (idempotent)
-- ============================================================

begin;

alter table public.orders
  add column if not exists client_user_agent text;

alter table public.orders
  drop constraint if exists orders_client_user_agent_len_check;

alter table public.orders
  add constraint orders_client_user_agent_len_check
  check (client_user_agent is null or char_length(client_user_agent) <= 512);

comment on column public.orders.client_user_agent is
  'user agent ตอนกดสั่งซื้อ ใช้ส่ง Meta CAPI (website event บังคับ) — เก็บเฉพาะ attribution_status = captured, NULL = ไม่ได้เก็บ';

commit;

-- ============================================================
-- ตรวจหลังรัน (อ่านอย่างเดียว ไม่แก้ข้อมูล)
--
-- 1) คอลัมน์ต้องมี
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'orders'
--     and column_name = 'client_user_agent';
--
-- ผลที่ต้องได้:  client_user_agent | text | YES
--
-- 2) constraint ต้องมี
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.orders'::regclass
--     and conname = 'orders_client_user_agent_len_check';
--
-- ผลที่ต้องได้: 1 แถว
--
-- 3) ออเดอร์เดิมต้องไม่ถูกแตะ
--   select count(*) filter (where client_user_agent is not null) as touched,
--          count(*) as total
--   from public.orders;
--
-- ผลที่ต้องได้ทันทีหลังรัน: touched = 0
-- ============================================================
