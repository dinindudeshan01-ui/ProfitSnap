-- Duplicate-shop detection — catches the "same person, same device,
-- signed up as two shops" case so it can be reviewed by an admin instead
-- of either being ignored (free-trial abuse) or auto-blocked (which would
-- also catch legitimate cases — a market with shared wifi, a family
-- running two actual separate shops on one shop tablet, etc).
--
-- Approach, deliberately soft: flag + hold the new signup's trial credits
-- pending manual review, never auto-suspend. An admin looks at each flag
-- and picks one of three outcomes — dismiss (false positive, release the
-- held credits), penalize (confirmed duplicate, keep credits withheld and
-- optionally deduct a fee), or suspend (both accounts, for repeat/serious
-- cases). See /api/admin/duplicates.

alter table tenants add column if not exists signup_device_id text;
alter table tenants add column if not exists signup_ip text;

create index if not exists idx_tenants_signup_device on tenants (signup_device_id);
create index if not exists idx_tenants_signup_ip on tenants (signup_ip);

create table if not exists tenant_duplicate_flags (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  matched_tenant_id uuid not null references tenants (id) on delete cascade,
  match_reason text not null check (match_reason in ('device', 'ip', 'both')),
  status text not null default 'pending' check (status in ('pending', 'dismissed', 'penalized', 'suspended')),
  credits_held boolean not null default true,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint no_self_match check (tenant_id <> matched_tenant_id)
);

create index if not exists idx_dupflags_tenant on tenant_duplicate_flags (tenant_id);
create index if not exists idx_dupflags_status on tenant_duplicate_flags (status);

alter table tenant_duplicate_flags enable row level security;

-- Admin-only table — tenants never query this directly (they aren't told
-- they've been flagged; they just see their trial credits pending, if at
-- all, same UX as a normal signup).
create policy dupflags_admin_only on tenant_duplicate_flags for all
  using (is_admin())
  with check (is_admin());

-- Lesson from the last incident: grant service_role explicitly, don't
-- assume it inherits anything.
grant select, insert, update, delete on tenant_duplicate_flags to service_role;
grant usage, select on all sequences in schema public to service_role;
