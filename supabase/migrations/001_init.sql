-- ============================================================
-- VINKO WOW LAB — schema เริ่มต้น (รอบ 3A)
-- รันไฟล์นี้ใน Supabase SQL Editor ทั้งไฟล์ครั้งเดียว
--
-- หลักการความปลอดภัยของ schema ชุดนี้:
--   ทุกตารางเปิด RLS และ "ไม่มี policy ให้ role anon เลยแม้แต่ข้อเดียว"
--   ใน PostgREST ถ้าไม่มี policy ที่อนุญาต = ปฏิเสธทุกอย่าง
--   ดังนั้น anon key ที่หลุดออกไปฝั่ง browser จะอ่านหรือเขียนอะไรไม่ได้เลย
--   ทุกการเข้าถึงข้อมูลต้องผ่าน /api/* ที่ใช้ service_role key เท่านั้น
--   (service_role bypass RLS โดยธรรมชาติ จึงไม่ต้องเขียน policy ให้)
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- orders
-- ------------------------------------------------------------
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),

  -- เลขที่ออเดอร์ที่ลูกค้าอ่านออก เช่น VK-2609-0001 (ใช้ในลายน้ำด้วย)
  order_ref           text not null unique,

  package_code        text not null check (package_code in ('LAB', 'BUNDLE')),

  -- เก็บเป็นสตางค์เสมอ ห้ามใช้ทศนิยมกับเงิน (199 บาท = 19900)
  amount_satang       integer not null check (amount_satang > 0),
  currency            text not null default 'THB',

  customer_name       text,
  customer_email      text not null,
  customer_phone      text,

  status              text not null default 'pending'
                        check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),

  omise_charge_id     text unique,
  payment_method      text check (payment_method in ('promptpay', 'card')),

  -- หลักฐานการยินยอม ต้องพิสูจน์ย้อนหลังได้ว่ายินยอมเมื่อไหร่ (PDPA)
  consent_terms_at    timestamptz,
  consent_privacy_at  timestamptz,
  consent_preorder_at timestamptz,          -- เฉพาะ BUNDLE

  paid_at             timestamptz,

  -- เพิ่มจาก spec เดิม 2 คอลัมน์ ด้วยเหตุผลด้านล่าง:
  --   ip_hash          = ใช้ทำ rate limit เก็บเป็น hash ไม่เก็บ IP ดิบ (PDPA)
  --   client_request_id = กันกดปุ่มรัวจนเกิดหลาย charge
  --                       client สร้าง id ต่อ 1 ครั้งที่กดจ่าย ถ้าซ้ำ = คืนออเดอร์เดิม
  ip_hash             text,
  client_request_id   text unique,

  -- บันทึกไว้ตรวจสอบเมื่อยอดที่จ่ายจริงไม่ตรงกับที่สั่ง
  amount_mismatch_note text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists orders_order_ref_idx       on public.orders (order_ref);
create index if not exists orders_omise_charge_id_idx on public.orders (omise_charge_id);
create index if not exists orders_customer_email_idx  on public.orders (customer_email);
create index if not exists orders_ip_hash_created_idx on public.orders (ip_hash, created_at desc);

-- ------------------------------------------------------------
-- order_items — 1 ออเดอร์มีหลายไฟล์ (BUNDLE = 6 ไฟล์)
-- ------------------------------------------------------------
create table if not exists public.order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete cascade,
  product_code            text not null,
  title                   text not null,
  delivery_type           text not null check (delivery_type in ('instant', 'preorder')),
  scheduled_delivery_date date,             -- เฉพาะนิทาน
  delivered_at            timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

-- ------------------------------------------------------------
-- download_events — log ทุกครั้งที่โหลด ใช้สืบกรณีไฟล์รั่ว
-- ------------------------------------------------------------
create table if not exists public.download_events (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  order_item_id  uuid references public.order_items(id) on delete cascade,
  downloaded_at  timestamptz not null default now(),
  ip_hash        text,                      -- hash เท่านั้น ห้ามเก็บ IP ดิบ (PDPA)
  user_agent     text
);

create index if not exists download_events_order_id_idx on public.download_events (order_id);

-- ------------------------------------------------------------
-- webhook_events — กัน Omise ส่ง webhook ซ้ำ
-- unique บน omise_event_id คือกลไกกันซ้ำ ไม่ใช่แค่ index เฉยๆ
-- ------------------------------------------------------------
create table if not exists public.webhook_events (
  id             uuid primary key default gen_random_uuid(),
  omise_event_id text not null unique,
  payload        jsonb,
  processed_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ตัวนับเลขที่ออเดอร์ — ต้อง atomic ไม่งั้นออเดอร์ที่เข้ามาพร้อมกันจะได้เลขชนกัน
-- ------------------------------------------------------------
create table if not exists public.order_counters (
  period text primary key,                  -- 'YYMM' เช่น '2609'
  last_no integer not null default 0
);

create or replace function public.next_order_ref()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  p text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  n integer;
begin
  insert into public.order_counters (period, last_no)
  values (p, 1)
  on conflict (period) do update set last_no = public.order_counters.last_no + 1
  returning last_no into n;

  return 'VK-' || p || '-' || lpad(n::text, 4, '0');
end;
$$;

revoke execute on function public.next_order_ref() from public, anon, authenticated;

-- ------------------------------------------------------------
-- updated_at อัตโนมัติ
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Row Level Security
--
-- เปิด RLS ทุกตาราง แล้ว "จงใจไม่สร้าง policy ใดๆ ทั้งสิ้น"
-- ผลคือ role anon และ authenticated ทำอะไรกับตารางเหล่านี้ไม่ได้เลย
-- ซึ่งคือสิ่งที่เราต้องการ เพราะข้อมูลออเดอร์และอีเมลลูกค้า
-- ต้องไม่ถูกอ่านจากฝั่ง browser ไม่ว่ากรณีใด
--
-- ถ้าวันหนึ่งต้องการให้ลูกค้าล็อกอินดูออเดอร์ตัวเองได้
-- ค่อยเพิ่ม policy ให้ role authenticated เจาะจงเป็นรายตารางทีหลัง
-- อย่าเพิ่ม policy ให้ anon เด็ดขาด
-- ============================================================
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.download_events enable row level security;
alter table public.webhook_events  enable row level security;
alter table public.order_counters  enable row level security;

-- ตัดสิทธิ์ระดับ GRANT ออกอีกชั้น เผื่อ RLS ถูกปิดโดยไม่ตั้งใจในอนาคต
revoke all on public.orders          from anon, authenticated;
revoke all on public.order_items     from anon, authenticated;
revoke all on public.download_events from anon, authenticated;
revoke all on public.webhook_events  from anon, authenticated;
revoke all on public.order_counters  from anon, authenticated;
