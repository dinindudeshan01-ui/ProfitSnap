import { createAdminServiceClient } from '@/lib/admin/server';

// Shared by every admin tenant-listing endpoint (dashboard's "all shops"
// list, district-filtered list, and Customer lookup search) so the
// definition of "needs attention" can't drift between them — a tenant
// flagged on the dashboard but not in search results (or vice versa)
// would be confusing and easy to miss.

export async function duplicateFlagIds(
  db: ReturnType<typeof createAdminServiceClient>,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await db
    .from('tenant_duplicate_flags')
    .select('tenant_id, matched_tenant_id')
    .eq('status', 'pending')
    .or(`tenant_id.in.(${ids.join(',')}),matched_tenant_id.in.(${ids.join(',')})`);
  return new Set((data ?? []).flatMap((f) => [f.tenant_id, f.matched_tenant_id]));
}

// A tenant "has a pending issue" if they have an unresolved escalation
// (failed OCR / staff escalation / user-reported issue not yet marked
// resolved — see migration-escalation-resolved.sql) or a refund request
// still awaiting a decision. Either one is something an admin needs to
// look at, which is the whole point of surfacing it anywhere in the
// admin panel.
export async function pendingIssueIds(
  db: ReturnType<typeof createAdminServiceClient>,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [escalations, refunds] = await Promise.all([
    db
      .from('scan_log')
      .select('tenant_id')
      .in('tenant_id', ids)
      .eq('resolved', false)
      .in('outcome', ['ocr_failed', 'staff_escalation', 'user_reported_issue']),
    db.from('refund_requests').select('tenant_id').in('tenant_id', ids).eq('status', 'pending'),
  ]);
  return new Set([...(escalations.data ?? []).map((r) => r.tenant_id), ...(refunds.data ?? []).map((r) => r.tenant_id)]);
}

// Flagged tenants first, so an admin scanning any list — dashboard,
// district, or search results — sees who needs attention without
// scrolling past everyone else first.
export function sortFlaggedFirst<T extends { hasPendingIssue?: boolean; pendingDuplicate?: boolean }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(b.hasPendingIssue || b.pendingDuplicate) - Number(a.hasPendingIssue || a.pendingDuplicate)
  );
}
