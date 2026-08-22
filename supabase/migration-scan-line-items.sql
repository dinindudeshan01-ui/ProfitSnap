-- Nothing currently records WHICH products a scan actually touched or
-- what changed — scan_log.committed_row_count is just a number. That
-- makes it impossible to show an admin "here's the photo, here's exactly
-- what inventory changed because of it" when reviewing a refund or
-- report — which is the whole point of that review. This table is the
-- missing link: one row per product actually changed by a given scan,
-- with the before/after values, written at the moment confirmImport
-- saves each row (see ScanScreen.tsx).
create table if not exists scan_line_items (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scan_log (id) on delete cascade,
  tenant_id uuid not null default auth.uid() references tenants (id) on delete cascade,
  -- Nullable: if the product is later deleted, the change record (and
  -- the name/values captured at the time) should still survive for
  -- historical review — it just won't join to a live product row.
  product_id bigint references products (id) on delete set null,
  action text not null check (action in ('stock_in', 'sale', 'product_created', 'price_update')),
  product_name text not null, -- snapshot at write time, survives product deletion/rename
  qty numeric(12, 4),
  before_stock numeric(12, 4),
  after_stock numeric(12, 4),
  before_avg_cost numeric(12, 4),
  after_avg_cost numeric(12, 4),
  before_sell_price numeric(12, 4),
  after_sell_price numeric(12, 4),
  created_at timestamptz not null default now()
);

create index if not exists idx_scan_line_items_scan on scan_line_items (scan_id);
create index if not exists idx_scan_line_items_tenant on scan_line_items (tenant_id);

alter table scan_line_items enable row level security;

-- Tenants can read their own scan's line items (e.g. a future "what did
-- this scan change" view in the app itself), never write directly — all
-- writes happen server-side via the service role during confirmImport.
-- Matches the tenant_id = auth.uid() / is_admin() pattern used across
-- every other tenant-scoped table (see migration-multitenant.sql).
create policy "tenants read own scan line items" on scan_line_items
  for select using (tenant_id = auth.uid() or is_admin());

-- confirmImport in ScanScreen.tsx writes here directly from the tenant's
-- own session (same as it already does for products/sales) — not through
-- a server route — so an INSERT policy is required, scoped so a tenant
-- can only ever write rows tagged with their own tenant_id.
create policy "tenants insert own scan line items" on scan_line_items
  for insert with check (tenant_id = auth.uid());

-- RLS policies alone do NOT grant table access — this project's default
-- privileges don't auto-apply to new tables (see the same lesson already
-- documented in migration-duplicate-detection.sql). Without these, both
-- the tenant-side client (authenticated role) and the admin service-role
-- client get "permission denied for table" regardless of the policies
-- above, because there's no base grant to even attempt the query against.
grant select, insert on scan_line_items to authenticated;
grant select, insert, update, delete on scan_line_items to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
