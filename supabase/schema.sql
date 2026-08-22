-- ProfitSnap — Supabase schema
-- Mirrors the original expo-sqlite schema (products, sales, stock_in, settings)
-- one-for-one, with Postgres-native types. No auth/RLS yet — dev mode, single
-- shared shop record. Add a shop_id / user_id column + RLS policies later
-- when multi-tenant login is introduced.

create extension if not exists "pgcrypto";

create table if not exists products (
  id bigint generated always as identity primary key,
  code text default '',
  name text not null,
  unit text not null default 'pcs',
  avg_cost numeric(12, 4) not null default 0,
  sell_price numeric(12, 4) not null default 0,
  stock numeric(12, 4) not null default 0,
  created date,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id bigint generated always as identity primary key,
  pid bigint not null references products (id) on delete cascade,
  qty numeric(12, 4) not null,
  sell_price numeric(12, 4) not null,
  avg_cost numeric(12, 4) not null,
  date date not null,
  created_at timestamptz not null default now()
);

create table if not exists stock_in (
  id bigint generated always as identity primary key,
  pid bigint not null references products (id) on delete cascade,
  qty numeric(12, 4) not null,
  cost numeric(12, 4) not null,
  date date not null,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text
);

-- Scan audit trail — replaces the local expo-file-system "outbox" folder.
-- Photos themselves live in Supabase Storage (bucket: scans); this table
-- is the metadata record that used to be the matching .json sidecar file.
create table if not exists scan_log (
  id uuid primary key default gen_random_uuid(),
  scan_type text not null check (scan_type in ('setup', 'stock_in', 'sales')),
  outcome text not null check (outcome in ('ocr_success', 'ocr_failed', 'staff_escalation')),
  photo_path text, -- path inside the `scans` storage bucket
  row_count int,
  error text,
  comment text,
  contact_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_date on sales (date);
create index if not exists idx_sales_pid on sales (pid);
create index if not exists idx_stockin_pid on stock_in (pid);
create index if not exists idx_scanlog_created on scan_log (created_at desc);

-- ── Dev-mode access ──────────────────────────────────────────────────────
-- RLS is left disabled for now per dev requirements (no login yet).
-- When auth is added: enable RLS on every table above, add a shop_id/user_id
-- column, and scope all policies to auth.uid().
alter table products disable row level security;
alter table sales disable row level security;
alter table stock_in disable row level security;
alter table settings disable row level security;
alter table scan_log disable row level security;

-- Disabling RLS only removes row-level filtering — it does NOT grant table
-- access by itself. Tables created via a raw `create table` in the SQL
-- Editor don't automatically get GRANTs for anon/authenticated, so without
-- this block every query fails with "permission denied for table X" even
-- with RLS off.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  products, sales, stock_in, settings, scan_log
to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Future tables/sequences in this schema inherit the same grants automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
