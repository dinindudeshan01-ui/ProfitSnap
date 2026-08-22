import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';
import { duplicateFlagIds, pendingIssueIds, sortFlaggedFirst } from '@/lib/admin/tenantFlags';

// GET /api/admin/search?q=...
// Matches tenant id, business name, owner name, phone, or email.
// Uses the service client because search is inherently cross-tenant — the
// isolation boundary for this one endpoint is "admin-only", not per-tenant,
// which is why requireAdmin() below is not optional.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const db = createAdminServiceClient();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);

  let query = db
    .from('tenants')
    .select('id, business_name, owner_name, phone, email, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (isUuid) {
    query = query.eq('id', q);
  } else {
    const like = `%${q}%`;
    query = query.or(
      `business_name.ilike.${like},owner_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const [flaggedIds, issueIds] = await Promise.all([duplicateFlagIds(db, ids), pendingIssueIds(db, ids)]);

  return NextResponse.json({
    results: sortFlaggedFirst(
      rows.map((r) => ({ ...r, pendingDuplicate: flaggedIds.has(r.id), hasPendingIssue: issueIds.has(r.id) }))
    ),
  });
}
