-- openRefundRequest's duplicate-request guard (src/lib/credits/engine.ts)
-- was check-then-insert: SELECT for an existing pending/approved request,
-- then INSERT if nothing was found. That's a classic race — if the
-- function runs twice close together (a double-tap, a retried request,
-- two tabs), both calls can pass the SELECT before either INSERT lands,
-- producing two refund_requests rows for the same scan. This is the
-- database-level fix: a partial unique index makes a second row for the
-- same scan_id while one is still "live" (pending/auto_approved/approved)
-- physically impossible to insert, regardless of timing or which code
-- path calls it.
create unique index if not exists idx_one_live_refund_per_scan
  on refund_requests (scan_id)
  where status in ('pending', 'auto_approved', 'approved');
