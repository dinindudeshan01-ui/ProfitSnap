import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';

// GET /api/admin/billing
// Cross-tenant queue of plan/addon requests awaiting payment confirmation
// (see migration-payment-gating.sql — paid plans/addons no longer
// activate instantly, they sit as 'pending_payment' until an admin
// confirms payment). Before this route, approving one of these only
// worked from a specific tenant's Customer 360 page — an admin had to
// already know which tenant to look at. This is the same gap the
// Refunds/Escalations cross-tenant queues closed for their flows.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminServiceClient();

  const [pendingSubs, pendingAddons] = await Promise.all([
    db
      .from('tenant_subscriptions')
      .select('id, tenant_id, plan_id, created_at, tenants(business_name), plans(name, price_amount, currency, credits_included)')
      .eq('status', 'pending_payment')
      .order('created_at', { ascending: false }),
    db
      .from('tenant_addon_purchases')
      .select(
        'id, tenant_id, addon_id, purchased_at, tenants(business_name), addons(name, price_amount, currency, credits_included)'
      )
      .eq('status', 'pending_payment')
      .order('purchased_at', { ascending: false }),
  ]);

  if (pendingSubs.error) return NextResponse.json({ error: pendingSubs.error.message }, { status: 500 });
  if (pendingAddons.error) return NextResponse.json({ error: pendingAddons.error.message }, { status: 500 });

  const subs = (pendingSubs.data ?? []).map((r: any) => ({
    ...r,
    business_name: r.tenants?.business_name ?? '—',
  }));
  const addons = (pendingAddons.data ?? []).map((r: any) => ({
    ...r,
    business_name: r.tenants?.business_name ?? '—',
  }));

  return NextResponse.json({ pendingSubs: subs, pendingAddons: addons });
}
