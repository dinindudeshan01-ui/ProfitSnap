import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';

// GET /api/admin/ledger
// Intentionally cross-tenant — this is the finance oversight screen, not
// the per-customer view. Joins tenant business_name in so it's readable.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminServiceClient();
  const { data, error } = await db
    .from('credit_transactions')
    .select('id, type, amount, balance_after, note, created_at, tenant_id, tenants(business_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r: any) => ({
    ...r,
    business_name: r.tenants?.business_name ?? '—',
  }));

  return NextResponse.json({ transactions: rows });
}
