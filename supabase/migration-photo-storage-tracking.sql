-- Tracks the stored photo's size per scan, so per-shop and total storage
-- usage can be computed with a cheap SUM() instead of listing/HEADing
-- every object in the bucket (paths aren't tenant-prefixed, so a
-- per-tenant storage.list() isn't possible anyway — scan_log is the
-- source of truth for "which files belong to this tenant").
alter table scan_log add column if not exists photo_bytes int;
