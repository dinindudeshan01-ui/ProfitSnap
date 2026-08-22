-- Stores each tenant's device push token so a notification can actually
-- be targeted at them later (e.g. "your refund was approved", "your
-- scan needs review"). One tenant can have multiple tokens (multiple
-- devices/reinstalls) — all of them get a notification, stale ones are
-- just left to fail silently on send rather than proactively cleaned up
-- here (that's a job for whatever sends the notification, not this
-- table).
create table if not exists push_tokens (
  id bigint generated always as identity primary key,
  tenant_id uuid not null default auth.uid() references tenants (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  unique (tenant_id, token)
);

create index if not exists idx_push_tokens_tenant on push_tokens (tenant_id);

alter table push_tokens enable row level security;

create policy "tenants manage own push tokens" on push_tokens
  for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());

-- Same lesson as migration-scan-line-items.sql: RLS policies alone don't
-- grant table access, this project's defaults don't auto-apply to new
-- tables.
grant select, insert, update, delete on push_tokens to authenticated;
grant select, insert, update, delete on push_tokens to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
