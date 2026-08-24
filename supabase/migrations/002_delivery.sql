-- ============================================================
-- VINKO WOW LAB — ระบบส่งมอบไฟล์ (รอบ 3B)
-- รันต่อจาก 001_init.sql ใน Supabase SQL Editor
--
-- RLS: ใช้หลักการเดียวกับ 001 คือเปิด RLS แล้วไม่สร้าง policy ให้ anon เลย
-- ทุกการเข้าถึงผ่าน /api/* ด้วยกุญแจฝั่ง server เท่านั้น
-- ============================================================

-- ------------------------------------------------------------
-- token สำหรับหน้าดาวน์โหลด
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists download_token   text unique,
  add column if not exists token_expires_at timestamptz;

-- ค้นด้วย token ต้องเร็วเพราะเรียกทุกครั้งที่เปิดหน้าโหลด
create index if not exists orders_download_token_idx
  on public.orders (download_token) where download_token is not null;

comment on column public.orders.download_token is
  'สุ่ม 32+ ตัวอักษร ไม่ใช่ uuid เพราะ uuid เดาลำดับได้ง่ายกว่า';
comment on column public.orders.token_expires_at is
  'อายุ 48 ชั่วโมง ต่ออายุได้เมื่อลูกค้ากดขอลิงก์ใหม่ หรือเมื่อถึงกำหนดส่งนิทาน';

-- ------------------------------------------------------------
-- email_events — ไว้ไล่ตรวจตอนลูกค้าบอกว่าไม่ได้รับอีเมล
-- ------------------------------------------------------------
create table if not exists public.email_events (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid references public.orders(id) on delete set null,
  order_item_id     uuid references public.order_items(id) on delete set null,
  kind              text not null check (kind in ('purchase', 'story_delivery', 'resend_link')),
  to_email          text not null,
  subject           text,
  provider_message_id text,          -- id ที่ Resend คืนมา ใช้ค้นในหน้า dashboard ของ Resend
  status            text not null default 'sent' check (status in ('sent', 'failed')),
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists email_events_order_id_idx on public.email_events (order_id);
create index if not exists email_events_created_idx  on public.email_events (created_at desc);

-- ------------------------------------------------------------
-- นับจำนวนครั้งที่โหลดต่อไฟล์ (จำกัด 10 ครั้ง)
-- นับจาก download_events ที่มีอยู่แล้ว ไม่ต้องเพิ่มคอลัมน์
-- ------------------------------------------------------------
create index if not exists download_events_item_idx
  on public.download_events (order_item_id);

-- ------------------------------------------------------------
-- RLS สำหรับตารางใหม่ — จงใจไม่มี policy เช่นเดิม
-- ------------------------------------------------------------
alter table public.email_events enable row level security;
revoke all on public.email_events from anon, authenticated;
