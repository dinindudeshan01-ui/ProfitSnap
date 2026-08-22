-- Lets a flagged tenant explain their situation ("it's a shared shop
-- tablet, both accounts are real") before an admin decides. Purely
-- additive to the table from migration-duplicate-detection.sql.
alter table tenant_duplicate_flags add column if not exists appeal_note text;
alter table tenant_duplicate_flags add column if not exists appeal_submitted_at timestamptz;
