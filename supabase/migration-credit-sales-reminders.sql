-- ProfitSnap — Credit Sales, Reminders & Pricing Revision (Aug 2026)
-- Run this AFTER migration-plans-addons.sql and migration-payment-gating.sql.
--
-- What this adds:
--   1. `customers` — one row per person a shop has sold to on credit.
--   2. `credit_sales` — a debt ledger row per credit-sale scan (amount owed,
--      amount settled, due date). This is a NEW scan type ('credit_sale'),
--      not a variant of `sales` — a credit sale is a debt, not a completed
--      sale, so it needs its own settle/partial-settle lifecycle instead of
--      reusing the stock-deduction sale flow.
--   3. `reminders` — one row per reminder send attempt (audit trail + the
--      thing the monthly quota counts against).
--   4. Reminder gating columns on `plans` — reminders are a PLAN feature,
--      never purchasable as a credit addon (per product decision: Free tier
--      has zero reminder capability, full stop, no addon workaround).
--   5. Updated plans/addons rows matching the Aug 2026 pricing revision.

-- ── Customers ─────────────────────────────────────────────────────────────
create table if not exists customers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null,
  phone text, -- E.164 or local format; required to actually send an SMS reminder, not required to save the row
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_customers_tenant on customers (tenant_id);
-- Soft de-dup: same phone number for the same tenant should reuse the same
-- customer row across multiple credit sales, not fork a new row every scan.
create unique index if not exists idx_customers_tenant_phone
  on customers (tenant_id, phone) where phone is not null;

-- ── Credit sales (debt ledger) ───────────────────────────────────────────
create table if not exists credit_sales (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  customer_id bigint not null references customers (id) on delete cascade,
  pid bigint references products (id) on delete set null, -- nullable: a credit-sale scan may record a generic amount, not always a catalog item
  description text, -- free-text line item when not tied to a product, e.g. "groceries"
  amount numeric(12, 2) not null,
  amount_settled numeric(12, 2) not null default 0,
  status text not null default 'open' check (status in ('open', 'partially_settled', 'settled')),
  due_date date,
  scan_id uuid references scan_log (id) on delete set null,
  date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_creditsales_tenant on credit_sales (tenant_id);
create index if not exists idx_creditsales_customer on credit_sales (customer_id);
create index if not exists idx_creditsales_status on credit_sales (tenant_id, status) where status != 'settled';

-- ── scan_log: allow the new scan type ────────────────────────────────────
alter table scan_log drop constraint if exists scan_log_scan_type_check;
alter table scan_log add constraint scan_log_scan_type_check
  check (scan_type in ('setup', 'stock_in', 'sales', 'credit_sale'));

-- ── Reminders ─────────────────────────────────────────────────────────────
-- One row per merchant-initiated send. `status` tracks actual delivery so
-- the monthly quota (see reminders_used_this_period below) only counts
-- attempts that were actually dispatched, not ones that failed validation
-- (e.g. customer has no phone number on file).
create table if not exists reminders (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  customer_id bigint not null references customers (id) on delete cascade,
  credit_sale_id bigint references credit_sales (id) on delete set null,
  channel text not null default 'sms' check (channel in ('sms', 'whatsapp')),
  message text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_ref text, -- gateway message id, for tracing delivery with the SMS provider
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_reminders_tenant on reminders (tenant_id);
create index if not exists idx_reminders_tenant_period on reminders (tenant_id, created_at);

-- ── Plans: reminders are a plan feature, not an addon ────────────────────
-- reminder_limit_per_month = 0/null means "no reminder capability at all",
-- which is the Free-tier state — reminders can never be topped up via addon
-- per the product decision, only unlocked by moving to a paid plan.
alter table plans add column if not exists reminder_limit_per_month int not null default 0;
alter table plans add column if not exists scan_price_amount numeric(12, 2); -- effective Rs/scan this plan advertises, for display only (informational — actual charge still runs through credit_wallet)

-- ── Usage tracking view: reminders sent in the tenant's current billing period ──
-- Kept as a query helper (not a materialized counter) so it can't drift out
-- of sync with the reminders table itself.
create or replace view tenant_reminder_usage as
select
  ts.tenant_id,
  ts.plan_id,
  count(r.id) filter (
    where r.created_at >= ts.started_at
      and (ts.current_period_end is null or r.created_at < ts.current_period_end)
      and r.status = 'sent'
  ) as reminders_used_this_period
from tenant_subscriptions ts
left join reminders r on r.tenant_id = ts.tenant_id
where ts.status = 'active'
group by ts.tenant_id, ts.plan_id;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table customers enable row level security;
drop policy if exists customers_isolation on customers;
create policy customers_isolation on customers for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table credit_sales enable row level security;
drop policy if exists creditsales_isolation on credit_sales;
create policy creditsales_isolation on credit_sales for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

alter table reminders enable row level security;
drop policy if exists reminders_isolation on reminders;
create policy reminders_isolation on reminders for all
  using (tenant_id = auth.uid() or is_admin())
  with check (tenant_id = auth.uid() or is_admin());

grant select, insert, update on customers, credit_sales, reminders to authenticated;
create index if not exists idx_scanlog_tenant_type on scan_log (tenant_id, scan_type);

-- ── tenant_id defaults ────────────────────────────────────────────────────
-- Matches the pattern set in migration-tenant-signup.sql for every other
-- tenant-scoped table: without this default, inserts from the client (which
-- never sets tenant_id explicitly) either fail RLS or land with a null
-- tenant_id, since the write path here is the same client-side insert used
-- by products/sales/stock_in.
alter table customers alter column tenant_id set default auth.uid();
alter table credit_sales alter column tenant_id set default auth.uid();
alter table reminders alter column tenant_id set default auth.uid();

-- ── Pricing revision: update plans catalog ───────────────────────────────
-- Free tier: unchanged mechanics, just the new Rs 0.50/credit rate. No
-- reminder capability (reminder_limit_per_month stays 0).
update plans
set credits_included = 20, -- one free scan's worth, matches migration-fix-trial-credits.sql intent
    reminder_limit_per_month = 0
where price_amount = 0;

-- Small Business — Rs 299/mo: 30 scans (Rs 9/scan effective), 15 reminders
-- (Rs 1.5/reminder effective). credits_included covers the 30 scans at the
-- BASE credit rate (20 credits/scan) so the subscription draws from the
-- same wallet mechanism as everything else — no separate "plan scans"
-- counter to keep in sync.
insert into plans (name, description, price_amount, currency, billing_period, credits_included, scan_limit_per_month, reminder_limit_per_month, scan_price_amount, features, is_active, sort_order)
values (
  'Small Business',
  '30 AI scans and 15 customer reminders every month, at Rs 9/scan.',
  299,
  'LKR',
  'monthly',
  600,          -- 30 scans x 20 credits
  30,
  15,
  9,
  '["30 scans/month", "15 reminders/month", "Rs 9 per scan", "No ads"]'::jsonb,
  true,
  20
)
on conflict do nothing;

-- Small + Business — Rs 499/mo: 50 scans (Rs 7/scan effective), 30 reminders.
insert into plans (name, description, price_amount, currency, billing_period, credits_included, scan_limit_per_month, reminder_limit_per_month, scan_price_amount, features, is_active, sort_order)
values (
  'Small + Business',
  '50 AI scans and 30 customer reminders every month, at Rs 7/scan.',
  499,
  'LKR',
  'monthly',
  1000,         -- 50 scans x 20 credits
  50,
  30,
  7,
  '["50 scans/month", "30 reminders/month", "Rs 7 per scan", "No ads", "Priority support"]'::jsonb,
  true,
  30
)
on conflict do nothing;

-- ── Pricing revision: update addons catalog ──────────────────────────────
-- Addons are credit top-ups ONLY — never grant reminder capability. They
-- exist for Free-tier users who want more scans without subscribing, and
-- deliberately price above the subscription's per-scan rate so the
-- subscription always looks like the better deal.
update addons set is_active = false where credits_included > 0; -- retire any pre-revision addon rows rather than mutating them under a live name

insert into addons (name, description, price_amount, currency, billing_type, credits_included, is_active, sort_order)
values
  ('Top-up 100', '100 credits = 5 scans.', 50, 'LKR', 'one_time', 100, true, 10),
  ('Top-up 200', '200 credits = 10 scans.', 100, 'LKR', 'one_time', 200, true, 20)
on conflict do nothing;
