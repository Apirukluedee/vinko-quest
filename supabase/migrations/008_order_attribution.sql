-- ============================================================
-- 008 — เก็บ attribution ของออเดอร์ ณ เวลาสั่งซื้อ แบบเขียนครั้งเดียว
--
-- ที่มา: site.js เก็บ first/last touch (utm_* + activation_id + click id)
--        ไว้ใน localStorage หลังได้ consent แล้วเท่านั้น
--        แต่ไม่เคยถูกส่งมาเก็บคู่กับออเดอร์ -> ตอบไม่ได้ว่ายอดขายมาจากไหน
--
-- สิ่งที่เพิ่ม (additive ล้วน ไม่แตะข้อมูลเดิม):
--   orders.attribution_snapshot  jsonb  {first, last, captured_at, schema_version}
--   orders.attribution_status    text   captured | none | no_consent
--     captured   = ลูกค้ายินยอม และมี touch ที่ใช้ได้
--     none       = ยินยอมแต่ไม่มี touch / ข้อมูลเสีย / client ไม่ได้ส่ง flag มา
--     no_consent = ลูกค้าไม่ยินยอม cookie -> ไม่เก็บอะไรเลย
--     NULL       = ออเดอร์ก่อนมี migration นี้ (ไม่รู้) — ไม่ backfill
--
-- write-once: ค่าทั้งสองคอลัมน์ถูกกำหนดตอน INSERT เท่านั้น
--   UPDATE ใดๆ ที่เปลี่ยนค่า (รวมถึง NULL -> มีค่า) จะถูกปฏิเสธด้วย
--   ORDER_ATTRIBUTION_IMMUTABLE เพราะ snapshot ต้องเป็นความจริง ณ เวลาสั่งซื้อ
--   การเขียนทีหลังพิสูจน์ไม่ได้ว่าเป็นค่าของตอนนั้น
--   UPDATE คอลัมน์อื่น (status, omise_charge_id ฯลฯ) ทำได้ตามปกติ
--
-- ลำดับ deploy: รันไฟล์นี้บน production ก่อน แล้วค่อย deploy โค้ด
-- (บทเรียนจาก 007 — โค้ดขึ้นก่อน DB = checkout พัง)
-- รันซ้ำได้ (idempotent)
-- ============================================================

begin;

alter table public.orders
  add column if not exists attribution_snapshot jsonb,
  add column if not exists attribution_status   text;

alter table public.orders
  drop constraint if exists orders_attribution_status_check;

alter table public.orders
  add constraint orders_attribution_status_check
  check (attribution_status in ('captured', 'none', 'no_consent'));

-- snapshot มีได้เฉพาะตอน captured และต้องเป็น object
-- ออเดอร์เก่า (NULL ทั้งคู่) ผ่านเงื่อนไขนี้
-- ใช้ CASE + coalesce ให้ทุกแขนงได้ true/false เสมอ — CHECK ที่ได้ NULL ถือว่า "ผ่าน"
-- ถ้าเขียนเป็น OR ธรรมดา status NULL + snapshot มีค่า จะหลุดผ่านไปได้
alter table public.orders
  drop constraint if exists orders_attribution_consistent_check;

alter table public.orders
  add constraint orders_attribution_consistent_check
  check (
    case
      when attribution_status is null then attribution_snapshot is null
      when attribution_status = 'captured' then coalesce(jsonb_typeof(attribution_snapshot) = 'object', false)
      else attribution_snapshot is null
    end
  );

comment on column public.orders.attribution_snapshot is
  'first/last touch ณ เวลาสั่งซื้อ (schema_version 1) — เขียนครั้งเดียวตอน insert, NULL = ไม่ได้เก็บ';
comment on column public.orders.attribution_status is
  'captured | none | no_consent — เขียนครั้งเดียวตอน insert, NULL = ออเดอร์ก่อน migration 008';

create or replace function public.orders_attribution_write_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attribution_snapshot is distinct from old.attribution_snapshot
     or new.attribution_status is distinct from old.attribution_status then
    raise exception 'ORDER_ATTRIBUTION_IMMUTABLE: attribution is write-once (order %)', old.order_ref
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.orders_attribution_write_once() from public, anon, authenticated;

drop trigger if exists orders_attribution_write_once on public.orders;
create trigger orders_attribution_write_once
  before update on public.orders
  for each row execute function public.orders_attribution_write_once();

commit;

-- ============================================================
-- ตรวจหลังรัน (อ่านอย่างเดียว ไม่แก้ข้อมูล)
--
-- 1) คอลัมน์ต้องมีครบ 2 ตัว
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'orders'
--     and column_name in ('attribution_snapshot', 'attribution_status')
--   order by column_name;
--
-- ผลที่ต้องได้:
--   attribution_snapshot | jsonb | YES
--   attribution_status   | text  | YES
--
-- 2) constraint ต้องมีครบ 2 ตัว
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.orders'::regclass
--     and conname in ('orders_attribution_status_check', 'orders_attribution_consistent_check')
--   order by conname;
--
-- ผลที่ต้องได้: 2 แถว และ status_check มี 'captured', 'none', 'no_consent'
--
-- 3) trigger write-once ต้องเปิดอยู่
--   select tgname, tgenabled
--   from pg_trigger
--   where tgrelid = 'public.orders'::regclass
--     and tgname = 'orders_attribution_write_once';
--
-- ผลที่ต้องได้: 1 แถว tgenabled = 'O'
--
-- 4) ออเดอร์เดิมต้องไม่ถูกแตะ (ไม่มี backfill)
--   select count(*) filter (where attribution_status is not null
--                              or attribution_snapshot is not null) as touched,
--          count(*) as total
--   from public.orders;
--
-- ผลที่ต้องได้ทันทีหลังรัน: touched = 0
-- ============================================================
