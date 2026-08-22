-- ProfitSnap — Provision credit_wallet on tenant signup
-- Run this AFTER migration-tenant-signup.sql.
--
-- Gap this closes: handle_new_tenant_signup() creates the `tenants` row on
-- signup, but never creates a matching `credit_wallet` row. Since
-- migration-multitenant.sql rekeyed credit_wallet on tenant_id (removing
-- the old single hardcoded id=1 row), a brand-new tenant currently has NO
-- wallet row at all — the engine's `.select('balance')...single()` finds
-- zero rows and every scan/balance/topup call fails with "Failed to read
-- wallet". This trigger update creates the wallet row in the same
-- transaction as the tenant row, same pattern as the tenant-creation
-- trigger itself.
--
-- Starting balance is 0 here — adjust if you want new signups to start
-- with a free-credit grant (e.g. the "20 free credits/month" line in the
-- free plan's feature list is a plan benefit, not currently wired to an
-- actual credit grant anywhere — decide separately whether that should
-- happen here, on first login, or via a scheduled monthly job).

create or replace function handle_new_tenant_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenants (id, business_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'business_name', 'My Shop'),
    new.email
  )
  on conflict (id) do nothing;

  insert into public.credit_wallet (tenant_id, balance)
  values (new.id, 0)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

-- Trigger itself is unchanged (still on_auth_user_created -> this function)
-- since we only modified the function body, but re-declaring is harmless
-- and keeps this file runnable standalone.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_tenant_signup();

-- ── Backfill ────────────────────────────────────────────────────────────
-- Any tenant that signed up BEFORE this migration has a tenants row but no
-- credit_wallet row. Create the missing ones now so existing users aren't
-- broken until their "next" signup that never happens.
insert into public.credit_wallet (tenant_id, balance)
select t.id, 0
from public.tenants t
left join public.credit_wallet w on w.tenant_id = t.id
where w.tenant_id is null
on conflict (tenant_id) do nothing;
