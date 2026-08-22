import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function createTenantClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // ignore in Server Component render
        }
      },
    },
  });
}

// GET /api/tenant/billing
// Returns everything the Settings → Plan & Billing screen needs: the full
// active catalog (never hardcoded client-side) plus this tenant's current
// plan and purchased addons.
export async function GET() {
  const supabase = await createTenantClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [plans, addons, currentSub, myAddons, pendingSub, pendingAddons] = await Promise.all([
    supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('addons').select('*').eq('is_active', true).order('sort_order'),
    supabase
      .from('tenant_subscriptions')
      .select('*, plans(*)')
      .eq('tenant_id', user.id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('tenant_addon_purchases')
      .select('*, addons(*)')
      .eq('tenant_id', user.id)
      .eq('status', 'active'),
    // Awaiting admin payment confirmation — see migration-payment-gating.sql
    // and api/tenant/billing/[action]/route.ts. Settings shows these so the
    // tenant knows a request is in flight instead of it silently vanishing.
    supabase
      .from('tenant_subscriptions')
      .select('*, plans(*)')
      .eq('tenant_id', user.id)
      .eq('status', 'pending_payment')
      .maybeSingle(),
    supabase
      .from('tenant_addon_purchases')
      .select('*, addons(*)')
      .eq('tenant_id', user.id)
      .eq('status', 'pending_payment'),
  ]);

  if (plans.error) return NextResponse.json({ error: plans.error.message }, { status: 500 });
  if (addons.error) return NextResponse.json({ error: addons.error.message }, { status: 500 });

  return NextResponse.json({
    plans: plans.data,
    addons: addons.data,
    currentSubscription: currentSub.data,
    myAddons: myAddons.data ?? [],
    pendingSubscription: pendingSub.data,
    pendingAddons: pendingAddons.data ?? [],
  });
}
