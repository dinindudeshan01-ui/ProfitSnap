import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { buildCheckoutParams, isPayHereConfigured, PAYHERE_CHECKOUT_URL } from '@/lib/payments/payhere';

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

// POST /api/payments/payhere/checkout  { kind: 'plan' | 'addon', id: number }
//
// Creates the pending_payment row (same as the existing manual flow) and
// returns the PayHere checkout params for the client to submit. The row
// stays pending_payment until the notify webhook confirms actual payment
// — this endpoint never activates anything itself, it only starts the
// payment attempt.
export async function POST(req: Request) {
  if (!isPayHereConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Card payments are not set up yet. Please use bank transfer instead.' },
      { status: 503 }
    );
  }

  const supabase = await createTenantClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const kind = body.kind as 'plan' | 'addon';
  const id = Number(body.id);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

  if (kind === 'plan') {
    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (planErr || !plan) return NextResponse.json({ ok: false, error: 'Plan not found' }, { status: 404 });

    const { data: existingPending } = await supabase
      .from('tenant_subscriptions')
      .select('id')
      .eq('tenant_id', user.id)
      .eq('status', 'pending_payment')
      .maybeSingle();
    if (existingPending) {
      return NextResponse.json(
        { ok: false, error: 'You already have a plan change awaiting payment confirmation' },
        { status: 409 }
      );
    }

    const { data: created, error: insertErr } = await supabase
      .from('tenant_subscriptions')
      .insert({ tenant_id: user.id, plan_id: plan.id, status: 'pending_payment', provider: 'payhere' })
      .select('id')
      .single();
    if (insertErr || !created) return NextResponse.json({ ok: false, error: insertErr?.message }, { status: 500 });

    const orderId = `sub_${created.id}`;
    await supabase.from('tenant_subscriptions').update({ provider_ref: orderId }).eq('id', created.id);

    const checkoutParams = buildCheckoutParams({
      orderId,
      amount: Number(plan.price_amount),
      itemName: `ProfitSnap — ${plan.name}`,
      returnUrl: `${baseUrl}/settings?payment=success`,
      cancelUrl: `${baseUrl}/settings?payment=cancelled`,
      notifyUrl: `${baseUrl}/api/payments/payhere/notify`,
      customerFirstName: user.email?.split('@')[0] || 'Customer',
      customerEmail: user.email || '',
    });

    return NextResponse.json({ ok: true, checkoutUrl: PAYHERE_CHECKOUT_URL, params: checkoutParams });
  }

  if (kind === 'addon') {
    const { data: addon, error: addonErr } = await supabase
      .from('addons')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();
    if (addonErr || !addon) return NextResponse.json({ ok: false, error: 'Addon not found' }, { status: 404 });

    const { data: created, error: insertErr } = await supabase
      .from('tenant_addon_purchases')
      .insert({
        tenant_id: user.id,
        addon_id: addon.id,
        status: 'pending_payment',
        provider: 'payhere',
        note: 'Awaiting PayHere confirmation',
      })
      .select('id')
      .single();
    if (insertErr || !created) return NextResponse.json({ ok: false, error: insertErr?.message }, { status: 500 });

    const orderId = `addon_${created.id}`;
    await supabase.from('tenant_addon_purchases').update({ provider_ref: orderId }).eq('id', created.id);

    const checkoutParams = buildCheckoutParams({
      orderId,
      amount: Number(addon.price_amount),
      itemName: `ProfitSnap — ${addon.name}`,
      returnUrl: `${baseUrl}/settings?payment=success`,
      cancelUrl: `${baseUrl}/settings?payment=cancelled`,
      notifyUrl: `${baseUrl}/api/payments/payhere/notify`,
      customerFirstName: user.email?.split('@')[0] || 'Customer',
      customerEmail: user.email || '',
    });

    return NextResponse.json({ ok: true, checkoutUrl: PAYHERE_CHECKOUT_URL, params: checkoutParams });
  }

  return NextResponse.json({ ok: false, error: 'Invalid kind' }, { status: 400 });
}
