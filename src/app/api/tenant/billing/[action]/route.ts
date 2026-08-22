import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';

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

// POST /api/tenant/billing/change-plan  { plan_id }
// POST /api/tenant/billing/buy-addon    { addon_id }
// NOTE: no real payment gateway is wired in yet — this records the
// subscription/purchase and grants the included credits immediately, same
// as a "pay on account" flow. Swap in a payment step here once the email/
// payment workflow lands, before the credit grant.
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const supabase = await createTenantClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { action } = await params;
  const body = await req.json();

  if (action === 'change-plan') {
    const planId = Number(body.plan_id);
    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .eq('is_active', true)
      .maybeSingle();
    if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 });
    if (!plan) return NextResponse.json({ error: 'Plan not found or no longer available' }, { status: 404 });

    const isFreeTrial = Number(plan.price_amount) === 0;

    if (!isFreeTrial) {
      // No payment gateway is wired in yet — a paid plan can't be
      // activated (or its credits granted) on the spot. Instead this
      // opens a pending request an admin confirms once payment has
      // actually been received. The tenant's current plan stays active
      // and untouched until then, so they're never left without one
      // while waiting.
      const { data: existingPending } = await supabase
        .from('tenant_subscriptions')
        .select('id')
        .eq('tenant_id', user.id)
        .eq('status', 'pending_payment')
        .maybeSingle();
      if (existingPending) {
        return NextResponse.json(
          { error: 'You already have a plan change awaiting payment confirmation' },
          { status: 409 }
        );
      }

      const { error: pendingErr } = await supabase.from('tenant_subscriptions').insert({
        tenant_id: user.id,
        plan_id: plan.id,
        status: 'pending_payment',
      });
      if (pendingErr) return NextResponse.json({ error: pendingErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, plan, pending: true });
    }

    // Cancel any existing active subscription, then start the new one —
    // the partial unique index (one active sub per tenant) means these
    // must happen in this order, not concurrently.
    const { error: cancelErr } = await supabase
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', user.id)
      .eq('status', 'active');
    if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });

    // Free plans are a 7-day trial, not an ongoing subscription — give
    // them an expiry so Settings can warn the tenant before it lapses.
    const periodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: subErr } = await supabase.from('tenant_subscriptions').insert({
      tenant_id: user.id,
      plan_id: plan.id,
      status: 'active',
      current_period_end: periodEnd,
    });
    if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

    if (plan.credits_included > 0) {
      // tenant_duplicate_flags is admin-only RLS — must check via the
      // service client, or this query silently returns nothing under the
      // tenant's own session and the hold never actually applies.
      const { data: heldFlag } = await createServiceClient()
        .from('tenant_duplicate_flags')
        .select('id')
        .eq('tenant_id', user.id)
        .eq('status', 'pending')
        .eq('credits_held', true)
        .limit(1)
        .maybeSingle();

      if (!heldFlag) {
        await grantCredits(supabase, user.id, plan.credits_included, `Plan change: ${plan.name}`);
      }
      // else: credits withheld pending admin review — see
      // /api/admin/duplicates. The subscription/trial period still starts
      // normally either way; only the bonus credits are on hold.
    }

    return NextResponse.json({ ok: true, plan });
  }

  if (action === 'buy-addon') {
    const addonId = Number(body.addon_id);
    const { data: addon, error: addonErr } = await supabase
      .from('addons')
      .select('*')
      .eq('id', addonId)
      .eq('is_active', true)
      .maybeSingle();
    if (addonErr) return NextResponse.json({ error: addonErr.message }, { status: 500 });
    if (!addon) return NextResponse.json({ error: 'Addon not found or no longer available' }, { status: 404 });

    const isFree = Number(addon.price_amount) === 0;

    if (!isFree) {
      // Same gating as paid plans above — no gateway yet, so this opens a
      // pending request instead of activating and granting credits.
      const { error: pendingErr } = await supabase.from('tenant_addon_purchases').insert({
        tenant_id: user.id,
        addon_id: addon.id,
        status: 'pending_payment',
        note: 'Awaiting admin payment confirmation',
      });
      if (pendingErr) return NextResponse.json({ error: pendingErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, addon, pending: true });
    }

    const { error: purchaseErr } = await supabase.from('tenant_addon_purchases').insert({
      tenant_id: user.id,
      addon_id: addon.id,
      status: 'active',
    });
    if (purchaseErr) return NextResponse.json({ error: purchaseErr.message }, { status: 500 });

    if (addon.credits_included > 0) {
      await grantCredits(supabase, user.id, addon.credits_included, `Addon purchased: ${addon.name}`);
    }

    return NextResponse.json({ ok: true, addon });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

async function grantCredits(
  supabase: Awaited<ReturnType<typeof createTenantClient>>,
  tenantId: string,
  amount: number,
  note: string
) {
  const { data: wallet } = await supabase
    .from('credit_wallet')
    .select('balance')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const newBalance = (wallet?.balance ?? 0) + amount;

  await supabase.from('credit_transactions').insert({
    tenant_id: tenantId,
    type: 'topup',
    amount,
    balance_after: newBalance,
    note,
  });
  await supabase
    .from('credit_wallet')
    .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
}
