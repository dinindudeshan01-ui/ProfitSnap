-- The 'scans' Supabase Storage bucket was never actually created
-- anywhere in this codebase — not in any migration, not in setup code.
-- Every scan photo upload has been failing silently since day one:
-- uploadScanPhoto() in api/scan/route.ts swallows the storage error and
-- just stores photo_path as null, so scan_log rows have never had a real
-- photo attached, the "your photo is saved as proof" message shown to
-- users has never been true, and the Escalations/Refunds admin pages
-- never had anything to render (fixed separately to actually display the
-- photo — this migration is what makes there be a photo to display).
--
-- Private bucket: nothing here is served publicly. Every read goes
-- through createSignedUrls() called with the service-role client (see
-- api/admin/escalations/route.ts, api/admin/refunds/route.ts,
-- api/admin/customer/[tenantId]/photos/route.ts), which has full access
-- regardless of bucket-level RLS — so no storage.objects policy is
-- required for the current admin-only viewing flow.
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

-- If this INSERT fails with a permissions error in your Supabase
-- project (some hosting configurations restrict direct writes to
-- storage.buckets even from the SQL Editor), create it manually instead:
-- Dashboard → Storage → New bucket → name "scans" → Private.
