import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';

// GET /api/admin/escalations
// Cross-tenant queue of scans that failed OCR or were flagged by the user
// for staff review — the human-in-the-loop screen for quality control.
// Only unresolved rows show by default (see
// migration-escalation-resolved.sql) — otherwise every scan ever flagged
// stays in this list forever, even after an admin already dealt with it.
// Pass ?status=all to see resolved ones too.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const statusFilter = new URL(req.url).searchParams.get('status') ?? 'unresolved';

  const db = createAdminServiceClient();
  let query = db
    .from('scan_log')
    .select(
      'id, scan_type, outcome, photo_path, row_count, error, comment, contact_email, user_feedback, user_comment, issue_reason, resolved, resolved_at, resolved_by, created_at, tenant_id, tenants(business_name, district)'
    )
    .in('outcome', ['ocr_failed', 'staff_escalation', 'user_reported_issue'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (statusFilter === 'unresolved') query = query.eq('resolved', false);
  else if (statusFilter === 'resolved') query = query.eq('resolved', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Sign the photo for every row that has one — this is the actual scan
  // photo (the "proof" the person was told is saved), not just a text
  // description. Without this, an admin reviewing a report has no way to
  // see what was actually scanned short of digging into Customer 360.
  const paths = rows.map((r: any) => r.photo_path).filter((p): p is string => !!p);
  let signedUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await db.storage.from('scans').createSignedUrls(paths, 60 * 15); // 15 min
    signedUrls = Object.fromEntries(
      (signed ?? []).map((s, i) => [paths[i], s.signedUrl ?? '']).filter(([, url]) => url)
    );
  }

  const enriched = rows.map((r: any) => ({
    ...r,
    business_name: r.tenants?.business_name ?? '—',
    district: r.tenants?.district ?? null,
    photo_url: r.photo_path ? signedUrls[r.photo_path] ?? null : null,
  }));
  return NextResponse.json({ escalations: enriched });
}
