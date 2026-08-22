-- One-time fix for data created BEFORE the resolveLinkedScan fix existed:
-- any scan_log row that's still `resolved = false` but whose linked
-- refund_requests row is already decided (approved/denied/auto_approved,
-- i.e. NOT pending) has nothing left to actually do — the code fix
-- prevents this from happening again going forward, this just cleans up
-- the ones already stuck from before it.
update scan_log
set resolved = true,
    resolved_at = now(),
    resolved_by = 'system (backfill: refund already decided)'
where resolved = false
  and id in (
    select scan_id from refund_requests where status <> 'pending'
  );
