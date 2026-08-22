-- A short, sayable-over-the-phone shop ID (#1, #2, #3...) alongside the
-- UUID primary key. The UUID stays the real identifier everywhere in code
-- (foreign keys, RLS, URLs) — this is purely a support-facing label, shown
-- in the tenant app (Settings, Home) and admin (search results, customer
-- detail) so a shop owner can read out "shop 214" over the phone instead
-- of a UUID.
alter table tenants add column if not exists shop_no bigint generated always as identity;

create unique index if not exists idx_tenants_shop_no on tenants (shop_no);
