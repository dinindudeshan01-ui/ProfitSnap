import { NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';

// GET /api/tenant/trial-status
// Deliberately separate from /api/tenant/billing (which returns the full
// plans/addons/pending-requests payload) — this is called on every page
// load for the header banner, so it only fetches the one thing that
// decides whether to show it.
export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: sub } = await supabase
    .from('tenant_subscriptions')
    .select('current_period_end, plans(price_amount)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();

  const isFreePlan = !sub || Number((sub.plans as unknown as { price_amount: number } | null)?.price_amount ?? 0) === 0;
  const periodEnd = sub?.current_period_end ?? null;
  const trialEnded = isFreePlan && !!periodEnd && new Date(periodEnd).getTime() <= Date.now();

  return NextResponse.json({ trialEnded, periodEnd, isFreePlan });
}
