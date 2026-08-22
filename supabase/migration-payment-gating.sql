-- Closes a real gap: change-plan/buy-addon previously activated ANY plan
-- or addon instantly and granted its included credits immediately,
-- regardless of price — there's no payment gateway wired in, so a paid
-- plan and a free plan behaved identically. A tenant could "buy" a paid
-- addon and get the credits for free.
--
-- Fix: paid (price_amount > 0) plans/addons now go to 'pending_payment'
-- instead of 'active' and grant no credits until an admin confirms
-- payment was actually received (manually, until a real gateway exists)
-- and activates the request. Free plans/addons are unaffected — they
-- still activate instantly, since there's nothing to pay.

alter table tenant_subscriptions drop constraint if exists tenant_subscriptions_status_check;
alter table tenant_subscriptions add constraint tenant_subscriptions_status_check
  check (status in ('active', 'cancelled', 'expired', 'pending_payment'));

alter table tenant_addon_purchases drop constraint if exists tenant_addon_purchases_status_check;
alter table tenant_addon_purchases add constraint tenant_addon_purchases_status_check
  check (status in ('active', 'cancelled', 'expired', 'pending_payment'));

-- The partial unique index only covered 'active' — a tenant could
-- previously queue up multiple pending_payment subscriptions by hitting
-- change-plan repeatedly. One pending request at a time is enough; admin
-- resolves it (approve or reject) before another can be created.
create unique index if not exists idx_one_pending_sub_per_tenant
  on tenant_subscriptions (tenant_id) where status = 'pending_payment';
