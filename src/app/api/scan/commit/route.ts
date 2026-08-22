// POST /api/scan/commit
// Called once the user actually saves the reviewed rows into
// products/sales/stock_in. This is the ONLY place that sets
// scan_log.rows_committed = true — it exists specifically so refund
// eligibility can be a provable fact ("credits charged AND inventory
// never updated") instead of taking the user's word for it.
//
// Body: { scanId: string, rowCount: number }

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { scanId, rowCount } = await req.json();
    if (typeof scanId !== 'string' || !scanId) {
      return NextResponse.json({ ok: false, error: 'scanId is required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('scan_log')
      .update({ rows_committed: true, committed_row_count: rowCount ?? null })
      .eq('id', scanId);

    if (error) {
      console.error('Commit marking failed:', error);
      return NextResponse.json({ ok: false, error: 'Could not record commit' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Commit error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
