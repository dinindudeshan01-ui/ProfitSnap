// POST /api/credits/refund
// Manually request a refund for a past scan — used from the credits
// history screen (vs. the immediate post-scan feedback prompt, which
// auto-opens a request when the user taps "incorrect"). Same eligibility
// logic either way: auto-approved only when the system can prove
// "charged but inventory never updated," otherwise queued for admin.
//
// Body: { scanId: string, reason?: string }

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { checkRefundEligibility, issueRefund } from '@/lib/credits/engine';

// GET /api/credits/refund
// This tenant's own refund request history — pending, approved (full or
// partial), denied, and auto-approved. Separate from /api/credits/history
// (the raw ledger) because it needs status + decision_note detail that
// only exists on refund_requests, not on the transaction row.
export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('refund_requests')
    .select('id, scan_id, credits_requested, credits_approved, reason, decision_note, status, decided_at, created_at')
    // Service-role client bypasses RLS — this filter is the isolation
    // boundary, same as every other tenant-scoped call in this file.
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ ok: false, error: 'Could not load refund history' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, refunds: data ?? [] });
}

export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { scanId, reason } = await req.json();
    if (typeof scanId !== 'string' || !scanId) {
      return NextResponse.json({ ok: false, error: 'scanId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: existing } = await supabase
      .from('refund_requests')
      .select('id, status')
      .eq('scan_id', scanId)
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'auto_approved', 'approved'])
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        ok: true,
        refund: { status: existing.status, alreadyRequested: true },
      });
    }

    const { data: scan, error: scanErr } = await supabase
      .from('scan_log')
      .select('credits_charged')
      .eq('id', scanId)
      .eq('tenant_id', tenantId)
      .single();
    if (scanErr || !scan) {
      return NextResponse.json({ ok: false, error: 'Scan not found' }, { status: 404 });
    }
    if (scan.credits_charged <= 0) {
      return NextResponse.json({ ok: false, error: 'No credits were charged for this scan' }, { status: 400 });
    }

    const { data: request, error: insertErr } = await supabase
      .from('refund_requests')
      .insert({ tenant_id: tenantId, scan_id: scanId, credits_requested: scan.credits_charged, reason: reason?.trim() || null })
      .select('id')
      .single();
    if (insertErr || !request) {
      return NextResponse.json({ ok: false, error: 'Could not create refund request' }, { status: 500 });
    }

    const eligibility = await checkRefundEligibility(supabase, tenantId, scanId);

    if (eligibility.autoApprovable) {
      await issueRefund(supabase, tenantId, {
        scanId,
        amount: scan.credits_charged,
        refundRequestId: request.id,
        auto: true,
        decidedBy: 'system',
      });
      await supabase
        .from('refund_requests')
        .update({ status: 'auto_approved', decided_by: 'system', decided_at: new Date().toISOString() })
        .eq('id', request.id);
      return NextResponse.json({
        ok: true,
        refund: { status: 'auto_approved', creditsRefunded: scan.credits_charged, reason: eligibility.reason },
      });
    }

    return NextResponse.json({ ok: true, refund: { status: 'pending', reason: eligibility.reason } });
  } catch (err) {
    console.error('Refund request error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
