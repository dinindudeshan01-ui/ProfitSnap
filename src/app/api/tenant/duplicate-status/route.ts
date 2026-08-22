import { NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';

// GET /api/tenant/duplicate-status
// Tells the tenant whether they currently have credits held pending a
// duplicate-shop review, and any appeal they've already submitted. This
// table is admin-only RLS, so it must go through the service client —
// same pattern as the billing hold-check.
export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createServiceClient();
  const { data } = await db
    .from('tenant_duplicate_flags')
    .select('id, appeal_note, appeal_submitted_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .eq('credits_held', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ held: false });
  return NextResponse.json({
    held: true,
    flagId: data.id,
    appealNote: data.appeal_note,
    appealSubmittedAt: data.appeal_submitted_at,
  });
}

// POST /api/tenant/duplicate-status  { message: string }
// Submits/updates the tenant's explanation. Doesn't change the flag's
// status or release the hold — just gives the admin context before they
// decide. One appeal per flag; resubmitting overwrites the previous text
// rather than stacking messages, since there's no back-and-forth thread
// here, just a single "here's my situation."
export async function POST(req: Request) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const db = createServiceClient();
  const { data: flag } = await db
    .from('tenant_duplicate_flags')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .eq('credits_held', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!flag) return NextResponse.json({ error: 'No pending hold to appeal' }, { status: 400 });

  await db
    .from('tenant_duplicate_flags')
    .update({ appeal_note: message, appeal_submitted_at: new Date().toISOString() })
    .eq('id', flag.id);

  return NextResponse.json({ ok: true });
}
