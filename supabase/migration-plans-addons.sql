-- ProfitSnap — Plans, Addons & Branding migration
-- Run this AFTER migration-multitenant.sql.
--
-- Plans and addons are DATA, not code — the admin panel is the only place
-- that creates/edits/retires them. The customer settings page only ever
-- reads from these tables, never hardcodes a plan name or price.

-- ── Business profile extensions ────────────────────────────────────────
alter table tenants add column if not exists brand_color text not null default '#6C63FF';
alter table tenants add column if not exists is_registered boolean not null default false;
alter table tenants add column if not exists registration_no text;
-- registration_no only makes sense when is_registered = true; enforced in
-- the API layer (settings route) rather than a DB constraint, since a
-- business can legitimately toggle this back and forth while editing.

-- ── Plans catalog ───────────────────────────────────────────────────────
create table if not exists plans (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  price_amount numeric(12, 2) not null default 0,
  currency text not null default 'LKR',
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly', 'one_time')),
  credits_included int not null default 0,
  scan_limit_per_month int, -- null = unlimited
  features jsonb not null default '[]', -- array of short feature strings shown on the pricing card
  is_active boolean not null default true, -- inactive plans stay visible to tenants already on them, hidden from new signups
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Addons catalog ──────────────────────────────────────────────────────
create table if not exists addons (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  price_amount numeric(12, 2) not null default 0,
  currency text not null default 'LKR',
  billing_type text not null default 'one_time' check (billing_type in ('one_time', 'recurring')),
  credits_included int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Tenant subscriptions ────────────────────────────────────────────────
-- One active row per tenant at a time (app enforces this; a partial unique
-- index backs it up at the DB level).
create table if not exists tenant_subscriptions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  plan_id bigint not null references plans (id),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  cancelled_at timestamptz
);

create unique index if not exists idx_one_active_sub_per_tenant
  on tenant_subscriptions (tenant_id) where status = 'active';
create index if not exists idx_tenantsub_tenant on tenant_subscriptions (tenant_id);

-- ── Tenant addon purchases ──────────────────────────────────────────────
create table if not exists tenant_addon_purchases (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  addon_id bigint not null references addons (id),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  purchased_at timestamptz not null default now(),
  note text -- e.g. 'payment pending' until a real payment workflow is wired in
);

create index if not exists idx_addonpurchase_tenant on tenant_addon_purchases (tenant_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Catalog tables: every authenticated tenant can read active plans/addons
-- (it's a public price list once logged in); only admins can write.
alter table plans enable row level security;
drop policy if exists plans_read_active on plans;
create policy plans_read_active on plans for select using (is_active = true or is_admin());
drop policy if exists plans_admin_write on plans;
create policy plans_admin_write on plans for insert with check (is_admin());
drop policy if exists plans_admin_update on plans;
create policy plans_admin_update on plans for update using (is_admin());
drop policy if exists plans_admin_delete on plans;
create policy plans_admin_delete on plans for delete using (is_admin());

alter table addons enable row level security;
drop policy if exists addons_read_active on addons;
create policy addons_read_active on addons for select using (is_active = true or is_admin());
drop policy if exists addons_admin_write on addons;
create policy addons_admin_write on addons for insert with check (is_admin());
drop policy if exists addons_admin_update on addons;
create policy addons_admin_update on addons for update using (is_admin());
drop policy if exists addons_admin_delete on addons;
create policy addons_admin_delete on addons for delete using (is_admin());

-- Tenant-scoped tables: same isolation pattern as migration-multitenant.sql.
alter table tenant_subscriptions enable row level security;
drop policy if exists tenantsub_isolation on tenant_subscriptions;
create policy tenantsub_isolation on tenant_subscriptions for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table tenant_addon_purchases enable row level security;
drop policy if exists addonpurchase_isolation on tenant_addon_purchases;
create policy addonpurchase_isolation on tenant_addon_purchases for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

-- ── Grants ──────────────────────────────────────────────────────────────
grant select on plans, addons to authenticated;
grant select, insert, update, delete on tenant_subscriptions, tenant_addon_purchases to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── Seed a starter free plan so tenants aren't left plan-less ───────────
insert into plans (name, description, price_amount, currency, billing_period, credits_included, scan_limit_per_month, features, is_active, sort_order)
select 'Free', 'Get started with basic scanning', 0, 'LKR', 'monthly', 100, 30,
  '["100 free credits (7-day trial)", "Up to 30 scans/month", "1 shop"]'::jsonb, true, 0
where not exists (select 1 from plans);
