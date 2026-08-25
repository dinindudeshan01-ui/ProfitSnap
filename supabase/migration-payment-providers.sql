-- ProfitSnap — Payment gateway tracking (Aug 2026)
-- Run this AFTER migration-payment-gating.sql.
--
-- Adds the columns needed to actually confirm a pending_payment row
-- automatically, instead of only via manual admin review:
--   - provider: which gateway settled this (payhere / play_billing /
--     dialog_dcb / manual — 'manual' covers the existing admin-approval
--     path, so nothing already in the table needs backfilling)
--   - provider_ref: the gateway's own transaction/order id, so an
--     incoming webhook can find the matching row to update
--   - a partial unique index on provider_ref so the same webhook can't
--     double-process the same transaction if the gateway retries delivery

alter table tenant_subscriptions add column if not exists provider text;
alter table tenant_subscriptions add column if not exists provider_ref text;

alter table tenant_addon_purchases add column if not exists provider text;
alter table tenant_addon_purchases add column if not exists provider_ref text;

create unique index if not exists idx_tenantsub_provider_ref
  on tenant_subscriptions (provider, provider_ref) where provider_ref is not null;
create unique index if not exists idx_addonpurchase_provider_ref
  on tenant_addon_purchases (provider, provider_ref) where provider_ref is not null;

comment on column tenant_subscriptions.provider is
  'Which gateway settled this row: payhere, play_billing, dialog_dcb, or manual (admin-confirmed bank transfer, the pre-existing flow).';
comment on column tenant_subscriptions.provider_ref is
  'The gateway''s own transaction/order/purchaseToken id — lets an incoming webhook find and update the matching row.';
