import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';
import { sendPushNotification } from '@/lib/native/pushSender';

// POST /api/admin/customer/[tenantId]/actions
// body: { action: 'adjust_credits' | 'set_status' | 'add_note', ...payload }
// Every branch: (1) does the write scoped to tenantId, (2) writes an audit
// log row. Never add a new action here without both.
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tenantId } = await params;
  const body = await req.json();
  const db = createAdminServiceClient();

  if (body.action === 'adjust_credits') {
    const amount = Number(body.amount);
    const reason = String(body.reason || '').trim();
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: 'amount must be a non-zero number' }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: 'reason is required for manual adjustments' }, { status: 400 });
    }
    // Finance-only action — support staff can view but not move money.
    if (admin.role === 'support') {
      return NextResponse.json({ error: 'Your role cannot adjust credits' }, { status: 403 });
    }

    const { data: wallet, error: walletErr } = await db
      .from('credit_wallet')
      .select('balance')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (walletErr) return NextResponse.json({ error: walletErr.message }, { status: 500 });

    const newBalance = (wallet?.balance ?? 0) + amount;
    if (newBalance < 0) {
      return NextResponse.json({ error: 'Adjustment would take balance negative' }, { status: 400 });
    }

    const { error: txErr } = await db.from('credit_transactions').insert({
      tenant_id: tenantId,
      type: 'adjustment',
      amount,
      balance_after: newBalance,
      note: `${reason} (by ${admin.email})`,
    });
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

    const { error: upsertErr } = await db
      .from('credit_wallet')
      .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    await logAdminAction(admin, 'credit_adjustment', tenantId, { amount, reason, newBalance });
    return NextResponse.json({ ok: true, newBalance });
  }

  if (body.action === 'set_status') {
    const status = String(body.status);
    if (!['active', 'suspended', 'trial'].includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    const { error } = await db.from('tenants').update({ status }).eq('id', tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction(admin, 'set_status', tenantId, { status });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'add_note') {
    const note = String(body.note || '').trim();
    if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 });

    const { error } = await db.from('support_notes').insert({
      tenant_id: tenantId,
      admin_id: admin.id,
      admin_email: admin.email,
      note,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction(admin, 'note_added', tenantId, { note });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'update_product') {
    const productId = Number(body.productId);
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    // Only these fields are editable here — never let this action touch
    // id/tenant_id/created_at. Each is validated as a finite, non-negative
    // number (or a plain string for name/code/unit) before writing.
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
      patch.name = name;
    }
    if (body.code !== undefined) patch.code = String(body.code).trim();
    if (body.unit !== undefined) patch.unit = String(body.unit).trim() || 'pcs';
    for (const field of ['avg_cost', 'sell_price', 'stock'] as const) {
      if (body[field] !== undefined) {
        const num = Number(body[field]);
        if (!Number.isFinite(num) || num < 0) {
          return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
        }
        patch[field] = num;
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Scoped by tenant_id, not just product id — a rogue/typo'd productId
    // from another tenant can never be edited through this route.
    const { data: updated, error } = await db
      .from('products')
      .update(patch)
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: 'Product not found for this tenant' }, { status: 404 });

    await logAdminAction(admin, 'product_updated', tenantId, { productId, patch });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'approve_pending_plan') {
    // Finance-only, same as adjust_credits — this is the step that turns
    // a tenant's plan-change request into real granted credits, so it
    // needs the same permission level as moving money directly.
    if (admin.role === 'support') {
      return NextResponse.json({ error: 'Your role cannot approve billing requests' }, { status: 403 });
    }
    const { data: pending, error: findErr } = await db
      .from('tenant_subscriptions')
      .select('*, plans(*)')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_payment')
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!pending) return NextResponse.json({ error: 'No pending plan request for this tenant' }, { status: 404 });

    const { error: cancelErr } = await db
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });

    const { error: activateErr } = await db
      .from('tenant_subscriptions')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', pending.id);
    if (activateErr) return NextResponse.json({ error: activateErr.message }, { status: 500 });

    const plan = pending.plans;
    if (plan?.credits_included > 0) {
      const { data: wallet } = await db.from('credit_wallet').select('balance').eq('tenant_id', tenantId).maybeSingle();
      const newBalance = (wallet?.balance ?? 0) + plan.credits_included;
      const { error: txErr } = await db.from('credit_transactions').insert({
        tenant_id: tenantId,
        type: 'topup',
        amount: plan.credits_included,
        balance_after: newBalance,
        note: `Payment confirmed by ${admin.email}: ${plan.name}`,
      });
      if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
      const { error: upsertErr } = await db
        .from('credit_wallet')
        .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
      if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    await logAdminAction(admin, 'plan_payment_approved', tenantId, { planId: pending.plan_id });
    sendPushNotification(db, tenantId, {
      title: 'Plan activated',
      body: `Your ${plan?.name ?? 'plan'} is now active${plan?.credits_included > 0 ? ` — ${plan.credits_included} credits added` : ''}.`,
      data: { type: 'billing_confirmed' },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reject_pending_plan') {
    if (admin.role === 'support') {
      return NextResponse.json({ error: 'Your role cannot reject billing requests' }, { status: 403 });
    }
    const { error } = await db
      .from('tenant_subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_payment');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction(admin, 'plan_payment_rejected', tenantId, { reason: body.reason ?? null });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'approve_pending_addon') {
    if (admin.role === 'support') {
      return NextResponse.json({ error: 'Your role cannot approve billing requests' }, { status: 403 });
    }
    const purchaseId = Number(body.purchaseId);
    const { data: pending, error: findErr } = await db
      .from('tenant_addon_purchases')
      .select('*, addons(*)')
      .eq('id', purchaseId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_payment')
      .maybeSingle();
    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
    if (!pending) return NextResponse.json({ error: 'No matching pending addon request' }, { status: 404 });

    const { error: activateErr } = await db
      .from('tenant_addon_purchases')
      .update({ status: 'active', note: `Payment confirmed by ${admin.email}` })
      .eq('id', pending.id);
    if (activateErr) return NextResponse.json({ error: activateErr.message }, { status: 500 });

    const addon = pending.addons;
    if (addon?.credits_included > 0) {
      const { data: wallet } = await db.from('credit_wallet').select('balance').eq('tenant_id', tenantId).maybeSingle();
      const newBalance = (wallet?.balance ?? 0) + addon.credits_included;
      const { error: txErr } = await db.from('credit_transactions').insert({
        tenant_id: tenantId,
        type: 'topup',
        amount: addon.credits_included,
        balance_after: newBalance,
        note: `Payment confirmed by ${admin.email}: ${addon.name}`,
      });
      if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
      const { error: upsertErr } = await db
        .from('credit_wallet')
        .upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
      if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    await logAdminAction(admin, 'addon_payment_approved', tenantId, { purchaseId: pending.id });
    sendPushNotification(db, tenantId, {
      title: 'Addon activated',
      body: `Your ${addon?.name ?? 'addon'} is now active${addon?.credits_included > 0 ? ` — ${addon.credits_included} credits added` : ''}.`,
      data: { type: 'billing_confirmed' },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'reject_pending_addon') {
    if (admin.role === 'support') {
      return NextResponse.json({ error: 'Your role cannot reject billing requests' }, { status: 403 });
    }
    const purchaseId = Number(body.purchaseId);
    const { error } = await db
      .from('tenant_addon_purchases')
      .update({ status: 'cancelled', note: `Rejected by ${admin.email}: ${body.reason ?? ''}`.trim() })
      .eq('id', purchaseId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_payment');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction(admin, 'addon_payment_rejected', tenantId, { purchaseId, reason: body.reason ?? null });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'resolve_escalation') {
    const scanId = String(body.scanId ?? '');
    if (!scanId) return NextResponse.json({ error: 'scanId is required' }, { status: 400 });

    const { error } = await db
      .from('scan_log')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: admin.email })
      .eq('id', scanId)
      .eq('tenant_id', tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAdminAction(admin, 'escalation_resolved', tenantId, { scanId });
    sendPushNotification(db, tenantId, {
      title: 'Report resolved',
      body: "The issue you reported has been reviewed and resolved — check your inventory.",
      data: { type: 'escalation_resolved', scanId },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
