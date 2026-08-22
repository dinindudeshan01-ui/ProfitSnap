-- The admin Escalations queue had no way to mark something as handled —
-- once a scan hit 'ocr_failed'/'staff_escalation'/'user_reported_issue',
-- it stayed in that queue forever even after an admin fixed the
-- inventory or issued a refund for it. This also blocks a "which
-- tenants/districts have an unresolved issue right now" view on the
-- dashboard, since without a resolved flag every flagged scan looks
-- permanently pending.

alter table scan_log add column if not exists resolved boolean not null default false;
alter table scan_log add column if not exists resolved_at timestamptz;
alter table scan_log add column if not exists resolved_by text;

create index if not exists idx_scan_log_unresolved
  on scan_log (tenant_id) where resolved = false and outcome in ('ocr_failed', 'staff_escalation', 'user_reported_issue');
