import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';

// GET /api/admin/customer/[tenantId]
// Every query below is explicitly filtered by tenantId, even though this
// uses the service client (which bypasses RLS). That explicit filter is
// the isolation boundary here — never remove a .eq('tenant_id', tenantId)
// to "simplify" a query on this route.
export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tenantId } = await params;
  const db = createAdminServiceClient();

  const [tenant, wallet, recentTx, recentScans, refunds, notes, products, salesAgg, productCount, duplicateFlags, pendingSub, pendingAddons] =
    await Promise.all([
      db.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
      db.from('credit_wallet').select('*').eq('tenant_id', tenantId).maybeSingle(),
      db
        .from('credit_transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(25),
      db
        .from('scan_log')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(25),
      db
        .from('refund_requests')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(25),
      db
        .from('support_notes')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(50),
      // Full row set (not just a count) — this is what backs the new
      // "Fix inventory" editor so admins can correct a bad OCR read
      // (e.g. cost came back as 0) directly, as an alternative to a
      // refund. Ordered by most recently created first since that's
      // usually the row an admin just heard a complaint about.
      db
        .from('products')
        .select('id, code, name, unit, avg_cost, sell_price, stock, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(200),
      db.from('sales').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      db.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      db
        .from('tenant_duplicate_flags')
        .select(
          `id, match_reason, status, appeal_note, appeal_submitted_at, created_at, tenant_id, matched_tenant_id,
           tenant:tenant_id ( business_name ), matched_tenant:matched_tenant_id ( business_name )`
        )
        .eq('status', 'pending')
        .or(`tenant_id.eq.${tenantId},matched_tenant_id.eq.${tenantId}`),
      // Awaiting payment confirmation — no gateway exists yet, so these
      // sit here until an admin manually confirms payment was received
      // (bank transfer, cash, etc.) and approves or rejects.
      db.from('tenant_subscriptions').select('*, plans(*)').eq('tenant_id', tenantId).eq('status', 'pending_payment').maybeSingle(),
      db.from('tenant_addon_purchases').select('*, addons(*)').eq('tenant_id', tenantId).eq('status', 'pending_payment'),
    ]);

  if (!tenant.data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

  const scanRows = recentScans.data ?? [];
  const failedOrEscalated = scanRows.filter(
    (s) => s.outcome === 'ocr_failed' || s.outcome === 'staff_escalation' || s.outcome === 'user_reported_issue'
  ).length;

  await logAdminAction(admin, 'view_customer_360', tenantId);

  return NextResponse.json({
    tenant: tenant.data,
    wallet: wallet.data,
    recentTransactions: recentTx.data ?? [],
    recentScans: scanRows,
    scanErrorRate: scanRows.length ? failedOrEscalated / scanRows.length : 0,
    refundRequests: refunds.data ?? [],
    supportNotes: notes.data ?? [],
    products: products.data ?? [],
    productCount: productCount.count ?? 0,
    salesCount: salesAgg.count ?? 0,
    duplicateFlags: duplicateFlags.data ?? [],
    pendingSubscription: pendingSub.data,
    pendingAddons: pendingAddons.data ?? [],
  });
}
