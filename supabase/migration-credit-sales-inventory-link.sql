-- ProfitSnap — Credit Sales: link to inventory (Aug 2026)
-- Run this AFTER migration-credit-sales-reminders.sql.
--
-- Why: `credit_sales` originally only stored a free-text `description` and
-- an `amount` — it never actually touched `products.stock`, even when the
-- credit sale was for a real catalog item. That's a real accounting gap:
-- a credit sale is still a sale (just unpaid), so if it doesn't decrement
-- stock, stock counts silently drift every time someone buys on credit.
--
-- This adds a `qty` column so the app can decrement stock the same way
-- SalesScreen/ScanScreen('sales') already does, only when the credit sale
-- is actually linked to a product via `pid`. Free-text credit sales (no
-- matching product) keep working exactly as before — qty stays null and
-- stock is untouched, since there's nothing in the catalog to decrement.

alter table credit_sales add column if not exists qty numeric(12, 2);

comment on column credit_sales.qty is
  'Units sold, only set when pid references a real catalog product. Used to decrement products.stock at save time — same max(0, stock-qty) clamp as a normal sale. Null/omitted for free-text (non-catalog) credit sales.';
