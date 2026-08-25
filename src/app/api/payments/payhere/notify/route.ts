import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { verifyNotifySignature, PAYHERE_STATUS } from '@/lib/payments/payhere';

// POST /api/payments/payhere/notify
// PayHere calls this server-to-server after a payment attempt completes —
// this is the ONLY place a payment actually gets confirmed and credits
// granted; the checkout/return_url flow never does that itself, since a
// user landing back on return_url doesn't prove payment actually settled
// (they could just navigate there manually).
//
// PayHere sends this as application/x-www-form-urlencoded, not JSON.
export async function POST(req: Request) {
  const formData = await req.formData();
  const payload = Object.fromEntries(formData.entries()) as Record<string, string>;

  const isValid = verifyNotifySignature({
    merchant_id: payload.merchant_id,
    order_id: payload.order_id,
    amount: payload.amount,
    payhere_amount: payload.payhere_amount,
    payhere_currency: payload.payhere_currency,
    status_code: payload.status_code,
    md5sig: payload.md5sig,
  });

  if (!isValid) {
    // Don't leak *why* it failed — just reject. A forged/malformed notify
    // should never be able to trigger a credit grant.
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 400 });
  }

  if (payload.status_code !== PAYHERE_STATUS.SUCCESS) {
    // Pending/cancelled/failed — nothing to activate. PayHere still
    // expects a 200 here so it doesn't keep retrying a legitimately
    // non-successful notification.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const orderId = payload.order_id; // e.g. "sub_123" or "addon_456"
  const service = createServiceClient(); // webhook has no user session — must use the service role

  if (orderId.startsWith('sub_')) {
    const subId = Number(orderId.replace('sub_', ''));
    const { data: sub } = await service
      .from('tenant_subscriptions')
      .select('*, plans(*)')
      .eq('id', subId)
      .eq('provider', 'payhere')
      .maybeSingle();
    if (!sub || sub.status !== 'pending_payment') {
      // Already processed (PayHere retried delivery) or not found —
      // either way, nothing more to do. Returning ok prevents PayHere
      // from retrying forever.
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    await service
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', sub.tenant_id)
      .eq('status', 'active');

    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // paid plans: 30-day period
    await service
      .from('tenant_subscriptions')
      .update({ status: 'active', current_period_end: periodEnd })
      .eq('id', subId);

    const plan = sub.plans as { credits_included?: number; name?: string } | null;
    if (plan?.credits_included && plan.credits_included > 0) {
      await grantCredits(service, sub.tenant_id, plan.credits_included, `Plan payment confirmed: ${plan.name}`);
    }
  } else if (orderId.startsWith('addon_')) {
    const purchaseId = Number(orderId.replace('addon_', ''));
    const { data: purchase } = await service
      .from('tenant_addon_purchases')
      .select('*, addons(*)')
      .eq('id', purchaseId)
      .eq('provider', 'payhere')
      .maybeSingle();
    if (!purchase || purchase.status !== 'pending_payment') {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    await service.from('tenant_addon_purchases').update({ status: 'active' }).eq('id', purchaseId);

    const addon = purchase.addons as { credits_included?: number; name?: string } | null;
    if (addon?.credits_included && addon.credits_included > 0) {
      await grantCredits(service, purchase.tenant_id, addon.credits_included, `Addon payment confirmed: ${addon.name}`);
    }
  }

  return NextResponse.json({ ok: true });
}

async function grantCredits(
  service: ReturnType<typeof createServiceClient>,
  tenantId: string,
  amount: number,
  note: string
) {
  const { data: wallet } = await service.from('credit_wallet').select('balance').eq('tenant_id', tenantId).maybeSingle();
  const newBalance = (wallet?.balance ?? 0) + amount;

  await service.from('credit_transactions').insert({
    tenant_id: tenantId,
    type: 'topup',
    amount,
    balance_after: newBalance,
    note,
  });
  await service
    .from('credit_wallet')
    .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
}
