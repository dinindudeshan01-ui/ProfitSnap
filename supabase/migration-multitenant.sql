-- ProfitSnap — Multi-tenant migration
-- Run this AFTER schema.sql and credit-engine-schema.sql.
--
-- What this does:
--   1. Creates `tenants` (one row per SME shop) linked 1:1 to a Supabase
--      auth.users row via tenant_id = auth.uid().
--   2. Adds tenant_id to every business table and backfills/enforces it.
--   3. Enables RLS everywhere, scoped to auth.uid() — a shop owner can only
--      ever see their own rows, enforced by Postgres, not app code.
--   4. Creates `admin_users` + `admin_audit_log` for the admin panel, and a
--      `is_admin()` helper so admin policies stay in one place.
--
-- Safe to run once. Existing single-shared-record dev data (id=1 wallet,
-- unscoped products/sales/etc.) is dev/test data with no owner — it gets
-- cleared rather than migrated, since it can't be attached to any real
-- auth.users account. See the README note at the bottom if that's wrong
-- for your situation.

-- ── Tenants ─────────────────────────────────────────────────────────────
create table if not exists tenants (
  id uuid primary key references auth.users (id) on delete cascade,
  business_name text not null,
  owner_name text,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'suspended', 'trial')),
  scan_limit_per_day int,
  credit_cap int,
  locale text default 'en',
  created_at timestamptz not null default now()
);

create index if not exists idx_tenants_status on tenants (status);
create index if not exists idx_tenants_phone on tenants (phone);
create index if not exists idx_tenants_business_name on tenants (lower(business_name));

-- ── tenant_id on every business table ──────────────────────────────────
alter table products add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table sales add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table stock_in add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table settings add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table scan_log add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table credit_wallet add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table credit_transactions add column if not exists tenant_id uuid references tenants (id) on delete cascade;
alter table refund_requests add column if not exists tenant_id uuid references tenants (id) on delete cascade;

-- Pre-migration dev data (from single-shared-shop mode, before tenants
-- existed) has no owner to attach to and can't satisfy the tenants→auth.users
-- foreign key. Since it was just dev/test data, clear it out rather than
-- inventing a fake tenant row for it. If you have real data here you need
-- to keep, stop and reassign it to a real auth user manually instead of
-- running this block.
delete from credit_transactions where tenant_id is null;
delete from refund_requests where tenant_id is null;
delete from scan_log where tenant_id is null;
delete from stock_in where tenant_id is null;
delete from sales where tenant_id is null;
delete from products where tenant_id is null;
delete from settings where tenant_id is null;
delete from credit_wallet where tenant_id is null;

-- settings.key was a global primary key under single-shop dev mode; make it
-- unique per tenant instead so each shop has its own settings row.
alter table settings drop constraint if exists settings_pkey;
alter table settings add primary key (tenant_id, key);

-- credit_wallet was a single hardcoded row (id=1); move to one row per
-- tenant, keyed by tenant_id instead of the fixed id.
alter table credit_wallet drop constraint if exists single_wallet;
alter table credit_wallet drop constraint if exists credit_wallet_pkey;
alter table credit_wallet add primary key (tenant_id);
alter table credit_wallet drop column if exists id;

create index if not exists idx_products_tenant on products (tenant_id);
create index if not exists idx_sales_tenant on sales (tenant_id);
create index if not exists idx_stockin_tenant on stock_in (tenant_id);
create index if not exists idx_scanlog_tenant on scan_log (tenant_id);
create index if not exists idx_credittx_tenant on credit_transactions (tenant_id);
create index if not exists idx_refund_tenant on refund_requests (tenant_id);

-- No backfill needed — pre-migration rows with no tenant_id were cleared
-- above. tenant_id is required going forward.

-- Now that everything's backfilled, going forward tenant_id is required.
alter table products alter column tenant_id set not null;
alter table sales alter column tenant_id set not null;
alter table stock_in alter column tenant_id set not null;
alter table settings alter column tenant_id set not null;
alter table scan_log alter column tenant_id set not null;
alter table credit_transactions alter column tenant_id set not null;
alter table refund_requests alter column tenant_id set not null;

-- ── Admin roles ─────────────────────────────────────────────────────────
-- Separate from tenants — admins are your team, not SME customers.
create table if not exists admin_users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'support' check (role in ('support', 'finance', 'superadmin')),
  created_at timestamptz not null default now()
);

-- Every admin action (impersonation, credit adjustment, suspension, etc.)
-- gets logged here — immutable, never updated/deleted by the app.
create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references admin_users (id) on delete set null,
  admin_email text not null,
  action text not null, -- e.g. 'credit_adjustment', 'impersonate', 'suspend', 'note_added'
  tenant_id uuid references tenants (id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_auditlog_tenant on admin_audit_log (tenant_id);
create index if not exists idx_auditlog_admin on admin_audit_log (admin_id);
create index if not exists idx_auditlog_created on admin_audit_log (created_at desc);

-- Free-form support notes per tenant, left by whoever handled a call/ticket.
create table if not exists support_notes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  admin_id uuid references admin_users (id) on delete set null,
  admin_email text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_supportnotes_tenant on support_notes (tenant_id, created_at desc);

-- Helper used inside RLS policies below.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from admin_users where id = auth.uid());
$$;

-- ── Row Level Security ─────────────────────────────────────────────────
-- Pattern for every tenant table: owners see only their own rows
-- (auth.uid() = tenant_id); admins see everything via is_admin().
-- The admin panel's server-side client should still explicitly filter by
-- tenant_id per screen (see admin.ts) — RLS is the safety net, not the UI.

alter table tenants enable row level security;
drop policy if exists tenant_self_select on tenants;
create policy tenant_self_select on tenants for select using (auth.uid() = id or is_admin());
drop policy if exists tenant_self_update on tenants;
create policy tenant_self_update on tenants for update using (auth.uid() = id or is_admin());
drop policy if exists tenant_admin_all on tenants;
create policy tenant_admin_all on tenants for all using (is_admin());

alter table products enable row level security;
drop policy if exists products_tenant_isolation on products;
create policy products_tenant_isolation on products for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table sales enable row level security;
drop policy if exists sales_tenant_isolation on sales;
create policy sales_tenant_isolation on sales for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table stock_in enable row level security;
drop policy if exists stockin_tenant_isolation on stock_in;
create policy stockin_tenant_isolation on stock_in for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table settings enable row level security;
drop policy if exists settings_tenant_isolation on settings;
create policy settings_tenant_isolation on settings for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table scan_log enable row level security;
drop policy if exists scanlog_tenant_isolation on scan_log;
create policy scanlog_tenant_isolation on scan_log for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table credit_wallet enable row level security;
drop policy if exists wallet_tenant_isolation on credit_wallet;
create policy wallet_tenant_isolation on credit_wallet for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table credit_transactions enable row level security;
drop policy if exists credittx_tenant_isolation on credit_transactions;
create policy credittx_tenant_isolation on credit_transactions for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());
-- Ledger is append-only in practice (enforced in app code / engine.ts);
-- RLS still allows admin 'adjustment' inserts, which is the only
-- sanctioned way to alter a tenant's balance outside their own actions.

alter table refund_requests enable row level security;
drop policy if exists refund_tenant_isolation on refund_requests;
create policy refund_tenant_isolation on refund_requests for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

-- Admin-only tables.
alter table admin_users enable row level security;
drop policy if exists admin_users_admin_only on admin_users;
create policy admin_users_admin_only on admin_users for select using (is_admin());
-- Inserts/updates to admin_users are done via service role only (adding a
-- teammate as admin is a deploy/ops action, not something exposed in-app).

alter table admin_audit_log enable row level security;
drop policy if exists auditlog_admin_only on admin_audit_log;
create policy auditlog_admin_only on admin_audit_log for select using (is_admin());
drop policy if exists auditlog_admin_insert on admin_audit_log;
create policy auditlog_admin_insert on admin_audit_log for insert with check (is_admin());

alter table support_notes enable row level security;
drop policy if exists supportnotes_admin_only on support_notes;
create policy supportnotes_admin_only on support_notes for all using (is_admin()) with check (is_admin());

-- ── Grants ──────────────────────────────────────────────────────────────
-- RLS (above) does the real access control now — these grants just let
-- authenticated users reach the tables at all; policies filter the rows.
grant select, insert, update, delete on
  tenants, products, sales, stock_in, settings, scan_log,
  credit_wallet, credit_transactions, refund_requests
to authenticated;
grant select on admin_users, admin_audit_log, support_notes to authenticated;
grant insert on admin_audit_log, support_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The anon key should no longer be used for direct table access once auth
-- ships — revoke it so a leaked anon key can't read/write tenant data.
revoke insert, update, delete on
  tenants, products, sales, stock_in, settings, scan_log,
  credit_wallet, credit_transactions, refund_requests
from anon;

-- ── README ──────────────────────────────────────────────────────────────
-- 1. This migration assumes Supabase Auth is enabled and each SME signs up
--    via auth.users (email/phone OTP, whichever you choose in Supabase
--    Auth settings). tenants.id === auth.users.id — create the tenants row
--    right after signup (e.g. in an on-signup trigger or your /setup flow).
-- 2. To make your first admin: after that person signs up through Supabase
--    Auth normally, run:
--      insert into admin_users (id, name, email, role)
--      values ('<their-auth-uid>', 'Your Name', 'you@company.com', 'superadmin');
-- 3. The client.ts anon-key browser client now relies on RLS + auth.uid()
--    for isolation. Update src/lib/supabase/client.ts call sites to attach
--    the logged-in session (createBrowserClient already does this once
--    supabase.auth.signIn* has been called) — no more anonymous single-shop
--    access.
-- 4. Pre-migration dev/test rows with no tenant_id are deleted by this
--    script (see the DELETE statements above), not migrated. If that data
--    mattered, restore from a backup and reassign it to a real tenant_id
--    manually before re-running this migration.
