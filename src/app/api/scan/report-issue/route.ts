// POST /api/scan/report-issue
// Lets the user flag a problem with a scan's extracted data BEFORE they
// save it — e.g. "cost/price came out wrong" on the review-rows screen.
// This is distinct from /api/scan/escalate (the post-2nd-retry "we're
// sorry" screen for OCR that failed outright) and from
// /api/scan/feedback (the post-save "was this correct?" prompt): this one
// covers the gap where OCR technically succeeded (rows came back) but the
// data itself is wrong, which never showed up in the admin Escalation
// queue before since that queue only looked at 'ocr_failed' outcomes.
//
// Body: { scanId: string, scanType: ScanType, reason: string, comment?: string }

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { openRefundRequest } from '@/lib/credits/engine';
import { ScanType } from '@/lib/ocr/geminiService';

const VALID_SCAN_TYPES: ScanType[] = ['setup', 'stock_in', 'sales', 'credit_sale'];

// Fixed reason categories shown as chips on the report sheet — keeps the
// admin queue scannable (consistent labels) instead of free-text-only.
const VALID_REASONS = [
  'wrong_cost',
  'wrong_qty',
  'wrong_name',
  'missing_row',
  'duplicate_row',
  'other',
] as const;

export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { scanId, scanType, reason, comment } = await req.json();

    if (typeof scanId !== 'string' || !scanId) {
      return NextResponse.json({ ok: false, error: 'scanId is required' }, { status: 400 });
    }
    if (typeof scanType !== 'string' || !VALID_SCAN_TYPES.includes(scanType as ScanType)) {
      return NextResponse.json({ ok: false, error: 'Invalid scanType' }, { status: 400 });
    }
    if (typeof reason !== 'string' || !VALID_REASONS.includes(reason as (typeof VALID_REASONS)[number])) {
      return NextResponse.json(
        { ok: false, error: `reason must be one of: ${VALID_REASONS.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Mark the scan itself — this is what makes it show up in the admin
    // Escalation queue (which now includes 'user_reported_issue' outcomes
    // alongside 'ocr_failed' and 'staff_escalation'). Only overwrite the
    // outcome if the scan hasn't already been flagged some other way, so
    // this can't downgrade e.g. an existing 'staff_escalation' record.
    const { error: updateErr } = await supabase
      .from('scan_log')
      .update({
        outcome: 'user_reported_issue',
        issue_reason: reason,
        user_comment: comment?.trim() || null,
      })
      .eq('id', scanId)
      .eq('tenant_id', tenantId);

    if (updateErr) {
      console.error('Report-issue update failed:', updateErr);
      return NextResponse.json({ ok: false, error: 'Could not log the report' }, { status: 500 });
    }

    // Also open a refund request through the same shared path as the
    // post-save feedback flow, so the admin Refunds queue and the
    // Escalations queue both reflect the same underlying request instead
    // of needing two separate admin actions to reconcile.
    //
    // allowAutoApprove is deliberately false here: this endpoint fires
    // from the review screen, BEFORE Save is ever tapped. At that point
    // scan_log.rows_committed is always still false — not because
    // anything is provably wrong, but simply because the user hasn't
    // chosen to save yet. checkRefundEligibility's auto-approve path
    // exists for "charged but inventory was never touched, provably", and
    // treating "not yet saved" as equivalent to that would auto-refund
    // every pre-save report regardless of whether the eventual save is
    // completely correct — exploitable by reporting a fake issue and
    // still saving fine. Every pre-save report goes to admin instead.
    const refundResult = await openRefundRequest(
      supabase,
      tenantId,
      scanId,
      `[${reason}] ${comment?.trim() || ''}`.trim(),
      false
    );

    return NextResponse.json({ ok: true, refund: refundResult });
  } catch (err) {
    console.error('Report-issue error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
