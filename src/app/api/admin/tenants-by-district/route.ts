import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';
import { duplicateFlagIds, pendingIssueIds, sortFlaggedFirst } from '@/lib/admin/tenantFlags';

// GET /api/admin/tenants-by-district
// - No `district` param: returns per-district counts (for the map's
//   color tiers) PLUS the full tenant list, always — not just after a
//   district is clicked — so the dashboard's left-hand list has
//   something to show by default. Each tenant is flagged
//   `hasPendingIssue` if they have an unresolved escalation or a pending
//   refund request, and each district with at least one such tenant is
//   listed in `issueDistricts` so the map can highlight it in red
//   regardless of its normal shop-count color tier.
// - `district` param: unchanged — the existing click-to-filter behavior,
//   now also carrying the same hasPendingIssue flag.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const district = new URL(req.url).searchParams.get('district');
  const db = createAdminServiceClient();

  if (district) {
    const { data, error } = await db
      .from('tenants')
      .select('id, business_name, email, status, created_at')
      .eq('district', district)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = data ?? [];
    const ids = rows.map((r) => r.id);
    const [flaggedIds, issueIds] = await Promise.all([duplicateFlagIds(db, ids), pendingIssueIds(db, ids)]);

    return NextResponse.json({
      tenants: sortFlaggedFirst(
        rows.map((r) => ({
          ...r,
          pendingDuplicate: flaggedIds.has(r.id),
          hasPendingIssue: issueIds.has(r.id),
        }))
      ),
    });
  }

  const { data: allTenants, error } = await db
    .from('tenants')
    .select('id, business_name, email, status, district, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = allTenants ?? [];
  const ids = rows.map((r) => r.id);
  const [flaggedIds, issueIds] = await Promise.all([duplicateFlagIds(db, ids), pendingIssueIds(db, ids)]);

  const counts: Record<string, number> = {};
  const issueDistricts = new Set<string>();
  for (const row of rows) {
    if (!row.district) continue;
    counts[row.district] = (counts[row.district] ?? 0) + 1;
    if (issueIds.has(row.id) || flaggedIds.has(row.id)) issueDistricts.add(row.district);
  }

  return NextResponse.json({
    counts,
    issueDistricts: Array.from(issueDistricts),
    tenants: sortFlaggedFirst(
      rows.map((r) => ({
        ...r,
        pendingDuplicate: flaggedIds.has(r.id),
        hasPendingIssue: issueIds.has(r.id),
      }))
    ),
  });
}
