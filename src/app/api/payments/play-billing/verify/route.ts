import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getRequestTenantId } from '@/lib/supabase/server';

// POST /api/payments/play-billing/verify  { purchaseToken: string }
//
// Called by the native Android app right after Play Billing's checkout
// sheet reports success. This is the step that actually matters — the
// client-side "purchase succeeded" callback only proves the checkout UI
// completed, not that the purchase is genuine (a tampered/rooted client
// could fake that callback locally). This route re-checks the purchase
// token directly against Google's own Play Developer API server-to-server
// — only THAT confirmation grants credits/activates the subscription.
//
// Setup needed before this works — see .env.example:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, GOOGLE_PLAY_PACKAGE_NAME
export async function POST(req: Request) {
  const tenantId = await getRequestTenantId(req);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const serviceAccountJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  if (!serviceAccountJson || !packageName) {
    return NextResponse.json(
      { ok: false, error: 'Play Billing verification is not configured yet' },
      { status: 503 }
    );
  }

  const body = await req.json();
  const purchaseToken = body.purchaseToken as string;
  const subscriptionId = 'profitsnap_pro_monthly'; // must match android-native's BillingRepository.SUBSCRIPTION_PRODUCT_ID
  if (!purchaseToken) {
    return NextResponse.json({ ok: false, error: 'Missing purchaseToken' }, { status: 400 });
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccountJson);

    const verifyRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!verifyRes.ok) {
      return NextResponse.json({ ok: false, error: 'Could not verify purchase with Google' }, { status: 502 });
    }
    const purchase = await verifyRes.json();

    // paymentState: 0 = pending, 1 = received, 2 = free trial
    if (purchase.paymentState !== 1 && purchase.paymentState !== 2) {
      return NextResponse.json({ ok: false, error: 'Purchase not in a paid state yet' }, { status: 400 });
    }

    const service = createServiceClient();

    // Idempotency: if this exact purchaseToken already activated a
    // subscription, don't grant credits twice (the app may retry this
    // call on a flaky connection).
    const { data: existing } = await service
      .from('tenant_subscriptions')
      .select('id')
      .eq('provider', 'play_billing')
      .eq('provider_ref', purchaseToken)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    const { data: plan } = await service.from('plans').select('*').eq('name', 'Small Business').maybeSingle();

    await service.from('tenant_subscriptions').update({ status: 'cancelled' }).eq('tenant_id', tenantId).eq('status', 'active');
    await service.from('tenant_subscriptions').insert({
      tenant_id: tenantId,
      plan_id: plan?.id,
      status: 'active',
      provider: 'play_billing',
      provider_ref: purchaseToken,
      current_period_end: new Date(Number(purchase.expiryTimeMillis)).toISOString(),
    });

    if (plan?.credits_included) {
      const { data: wallet } = await service.from('credit_wallet').select('balance').eq('tenant_id', tenantId).maybeSingle();
      const newBalance = (wallet?.balance ?? 0) + plan.credits_included;
      await service.from('credit_transactions').insert({
        tenant_id: tenantId,
        type: 'topup',
        amount: plan.credits_included,
        balance_after: newBalance,
        note: 'Google Play subscription confirmed',
      });
      await service.from('credit_wallet').upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
    }

    // Acknowledge the purchase with Google — required within 3 days or
    // Google auto-refunds it. Safe to call every time; Google no-ops if
    // already acknowledged.
    await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:acknowledge`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
    ).catch(() => {}); // best-effort — don't fail the whole request over this

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Play Billing verify failed:', err);
    return NextResponse.json({ ok: false, error: 'Internal error verifying purchase' }, { status: 500 });
  }
}

// Exchanges the service account's JSON key for a short-lived OAuth2
// access token via Google's standard JWT bearer flow — same auth pattern
// every Google Cloud service account uses, not specific to Play Billing.
async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const { GoogleAuth } = await import('google-auth-library');
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to obtain Google access token');
  return token.token;
}
