// POST /api/scan/escalate
// Used by the bill-scan flow's second-failure screen ("We're sorry..."),
// where the person can leave a comment + contact email for staff follow-up
// instead of (or alongside) entering items manually.
//
// Updates the EXISTING scan_log row (created by /api/scan on the first
// OCR attempt) rather than inserting a new one — this keeps the credit
// charge, retake count, and escalation note all on the same audit record,
// so a later refund check is looking at one coherent history instead of
// two disconnected rows for the same attempt.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { ScanType } from '@/lib/ocr/geminiService';

const VALID_SCAN_TYPES: ScanType[] = ['setup', 'stock_in', 'sales', 'credit_sale'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { scanType, scanId, comment, contactEmail } = body;

    if (typeof scanType !== 'string' || !VALID_SCAN_TYPES.includes(scanType as ScanType)) {
      return NextResponse.json({ ok: false, error: 'Invalid scanType' }, { status: 400 });
    }

    const supabase = createServiceClient();

    if (typeof scanId === 'string' && scanId) {
      const { error } = await supabase
        .from('scan_log')
        .update({
          outcome: 'staff_escalation',
          user_comment: comment?.trim() || null,
          contact_email: contactEmail?.trim() || null,
        })
        .eq('id', scanId);

      if (error) {
        console.error('Escalation update failed:', error);
        return NextResponse.json({ ok: false, error: 'Could not log escalation' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // Fallback for the rare case scanId is missing entirely (e.g. the very
    // first OCR call failed before a scan_log row could be created) — still
    // record the escalation rather than silently dropping it.
    const { error } = await supabase.from('scan_log').insert({
      scan_type: scanType,
      outcome: 'staff_escalation',
      user_comment: comment?.trim() || null,
      contact_email: contactEmail?.trim() || null,
    });

    if (error) {
      console.error('Escalation insert failed:', error);
      return NextResponse.json({ ok: false, error: 'Could not log escalation' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Escalation error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
