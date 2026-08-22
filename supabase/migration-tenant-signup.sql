-- ProfitSnap — Auto-create tenant on signup
-- Run this AFTER migration-multitenant.sql.
--
-- Without this, a brand-new auth.users row has no matching tenants row,
-- so the very first insert into products/settings/etc. (which references
-- tenants via tenant_id) fails on the foreign key. This trigger closes
-- that gap by creating the tenants row synchronously as part of signup
-- itself — the app never has to remember to do it, and there's no window
-- where a logged-in user exists without a tenant record.

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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_tenant_signup();

-- ── Insert-time convenience ────────────────────────────────────────────
-- Existing app code (queries.ts etc.) inserts into products/sales/stock_in/
-- settings/scan_log without setting tenant_id explicitly — it was written
-- for the old single-shared-shop dev mode. Rather than editing every
-- insert() call site, give tenant_id a default of the current session's
-- user, so it's filled in automatically and still satisfies the RLS
-- `with check (tenant_id = auth.uid())` policy.
alter table products alter column tenant_id set default auth.uid();
alter table sales alter column tenant_id set default auth.uid();
alter table stock_in alter column tenant_id set default auth.uid();
alter table settings alter column tenant_id set default auth.uid();
alter table scan_log alter column tenant_id set default auth.uid();
alter table credit_wallet alter column tenant_id set default auth.uid();
alter table credit_transactions alter column tenant_id set default auth.uid();
alter table refund_requests alter column tenant_id set default auth.uid();

-- ── README ──────────────────────────────────────────────────────────────
-- This does NOT fix "permission denied for table X" errors by itself —
-- that specific error means the request has no logged-in session at all
-- (falling back to the anon role, which no longer has write access after
-- migration-multitenant.sql). The app also needs an actual sign-in screen
-- for tenants (see /login in the app code) — this trigger just makes sure
-- that once someone DOES sign in, everything downstream works without
-- every insert() call needing a manual tenant_id.
