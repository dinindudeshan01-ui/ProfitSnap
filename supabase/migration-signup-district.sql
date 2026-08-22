-- Adds district capture to the signup trigger. Redefines
-- handle_new_tenant_signup() in full (Postgres functions aren't
-- patchable in place) — this reproduces everything from
-- migration-wallet-provisioning.sql and adds the district insert on top.
-- Run this AFTER that migration (and after migration-tenant-district.sql,
-- which added the column this reads into).

create or replace function handle_new_tenant_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenants (id, business_name, email, district)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'business_name', 'My Shop'),
    new.email,
    new.raw_user_meta_data ->> 'district'
  )
  on conflict (id) do nothing;

  insert into public.credit_wallet (tenant_id, balance)
  values (new.id, 0)
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_tenant_signup();
