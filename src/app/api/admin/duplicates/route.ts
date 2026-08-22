import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';

// GET /api/admin/duplicates?status=pending
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = new URL(req.url).searchParams.get('status') || 'pending';
  const db = createAdminServiceClient();

  let query = db
    .from('tenant_duplicate_flags')
    .select(
      `id, match_reason, status, credits_held, reviewed_by, reviewed_at, created_at, appeal_note, appeal_submitted_at,
       tenant:tenant_id ( id, business_name, email, signup_device_id, signup_ip, created_at ),
       matched_tenant:matched_tenant_id ( id, business_name, email, signup_device_id, signup_ip, created_at )`
    )
    .order('created_at', { ascending: false });

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ flags: data ?? [] });
}

// POST /api/admin/duplicates  { flagId: number, decision: 'dismiss' | 'penalize' | 'suspend' }
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot decide fraud flags' }, { status: 403 });
  }

  const body = await req.json();
  const flagId = Number(body.flagId);
  const decision = body.decision;
  if (!Number.isFinite(flagId) || !['dismiss', 'penalize', 'suspend'].includes(decision)) {
    return NextResponse.json({ error: 'flagId and a valid decision are required' }, { status: 400 });
  }

  const db = createAdminServiceClient();
  const { data: flag, error: fetchErr } = await db
    .from('tenant_duplicate_flags')
    .select('id, tenant_id, matched_tenant_id, status')
    .eq('id', flagId)
    .single();
  if (fetchErr || !flag) return NextResponse.json({ error: 'Flag not found' }, { status: 404 });
  if (flag.status !== 'pending') {
    return NextResponse.json({ error: `Already decided (${flag.status})` }, { status: 400 });
  }

  if (decision === 'dismiss') {
    // False positive — release the hold and grant whatever their current
    // plan would have given them, since that grant was skipped at signup.
    const { data: sub } = await db
      .from('tenant_subscriptions')
      .select('plan_id, plans(credits_included, name)')
      .eq('tenant_id', flag.tenant_id)
      .eq('status', 'active')
      .maybeSingle();

    const plan = sub?.plans as unknown as { credits_included: number; name: string } | null;
    if (plan && plan.credits_included > 0) {
      await grantCredits(db, flag.tenant_id, plan.credits_included, `Duplicate flag dismissed — releasing held trial credits (${plan.name})`);
    }

    await db
      .from('tenant_duplicate_flags')
      .update({ status: 'dismissed', credits_held: false, reviewed_by: admin.email, reviewed_at: new Date().toISOString() })
      .eq('id', flagId);

    await logAdminAction(admin, 'duplicate_flag_dismissed', flag.tenant_id, { flagId, matchedTenantId: flag.matched_tenant_id });
    return NextResponse.json({ ok: true, status: 'dismissed' });
  }

  if (decision === 'penalize') {
    // Confirmed duplicate, but not severe enough to suspend — credits stay
    // withheld (already the case) and we deduct a flat fee from whatever
    // balance they do have, floored at 0 (never push a wallet negative).
    const PENALTY_AMOUNT = 50;
    const { data: wallet } = await db.from('credit_wallet').select('balance').eq('tenant_id', flag.tenant_id).maybeSingle();
    const deduction = Math.min(PENALTY_AMOUNT, wallet?.balance ?? 0);

    if (deduction > 0) {
      const newBalance = (wallet?.balance ?? 0) - deduction;
      await db.from('credit_transactions').insert({
        tenant_id: flag.tenant_id,
        type: 'adjustment',
        amount: -deduction,
        balance_after: newBalance,
        note: 'Penalty: duplicate shop signup (same device/IP as an existing account)',
      });
      await db.from('credit_wallet').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('tenant_id', flag.tenant_id);
    }

    await db
      .from('tenant_duplicate_flags')
      .update({ status: 'penalized', reviewed_by: admin.email, reviewed_at: new Date().toISOString() })
      .eq('id', flagId);

    await logAdminAction(admin, 'duplicate_flag_penalized', flag.tenant_id, { flagId, matchedTenantId: flag.matched_tenant_id, deduction });
    return NextResponse.json({ ok: true, status: 'penalized', deduction });
  }

  // decision === 'suspend' — both accounts, since a confirmed duplicate
  // used to dodge trial limits usually means both are the same operator.
  await db.from('tenants').update({ status: 'suspended' }).in('id', [flag.tenant_id, flag.matched_tenant_id]);
  await db
    .from('tenant_duplicate_flags')
    .update({ status: 'suspended', reviewed_by: admin.email, reviewed_at: new Date().toISOString() })
    .eq('id', flagId);

  await logAdminAction(admin, 'duplicate_flag_suspended_both', flag.tenant_id, { flagId, matchedTenantId: flag.matched_tenant_id });
  return NextResponse.json({ ok: true, status: 'suspended' });
}

async function grantCredits(db: ReturnType<typeof createAdminServiceClient>, tenantId: string, amount: number, note: string) {
  const { data: wallet } = await db.from('credit_wallet').select('balance').eq('tenant_id', tenantId).maybeSingle();
  const newBalance = (wallet?.balance ?? 0) + amount;
  await db.from('credit_transactions').insert({ tenant_id: tenantId, type: 'topup', amount, balance_after: newBalance, note });
  await db.from('credit_wallet').upsert({ tenant_id: tenantId, balance: newBalance, updated_at: new Date().toISOString() });
}
