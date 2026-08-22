-- Adds a "Report an issue" path distinct from a hard OCR failure — for
-- scans that returned rows successfully (outcome = 'ocr_success') but
-- where the data itself is wrong (e.g. cost/qty misread). Previously the
-- only ways into the admin Escalation queue were 'ocr_failed' and
-- 'staff_escalation' (the post-2nd-retry screen); a user who noticed bad
-- data on a "successful" scan had no way to flag it before saving.

alter table scan_log drop constraint if exists scan_log_outcome_check;
alter table scan_log add constraint scan_log_outcome_check
  check (outcome in ('ocr_success', 'ocr_failed', 'staff_escalation', 'user_reported_issue'));

alter table scan_log add column if not exists issue_reason text;
