// POST /api/scan/feedback
// Powers the post-scan prompt: "Did you get the correct inventory
// measurement through the Snap&Go system?" If the user says incorrect,
// this also creates a refund_requests row and runs the eligibility check —
// auto-approving instantly when the system can prove "charged but
// inventory never updated," otherwise queuing for admin review.
//
// Body: { scanId: string, feedback: 'correct' | 'incorrect', comment?: string }

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { openRefundRequest } from '@/lib/credits/engine';

export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { scanId, feedback, comment } = await req.json();

    if (typeof scanId !== 'string' || !scanId) {
      return NextResponse.json({ ok: false, error: 'scanId is required' }, { status: 400 });
    }
    if (feedback !== 'correct' && feedback !== 'incorrect') {
      return NextResponse.json({ ok: false, error: "feedback must be 'correct' or 'incorrect'" }, { status: 400 });
    }

    const supabase = createServiceClient();

    await supabase
      .from('scan_log')
      .update({ user_feedback: feedback, user_comment: comment?.trim() || null })
      .eq('id', scanId)
      .eq('tenant_id', tenantId);

    if (feedback === 'correct') {
      return NextResponse.json({ ok: true, refund: null });
    }

    // feedback === 'incorrect' -> open a refund request automatically, so
    // the user doesn't have to separately go find a "request refund"
    // button after already telling us something was wrong.
    const refundResult = await openRefundRequest(supabase, tenantId, scanId, comment);
    return NextResponse.json({ ok: true, refund: refundResult });
  } catch (err) {
    console.error('Feedback error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
