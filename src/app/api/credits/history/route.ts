// GET /api/credits/history
// Returns the credit transaction ledger, newest first, joined with the
// associated scan_log row where present (so the UI can show "Scan #...
// stock_in, 3 retakes" instead of a bare transaction type).

import { NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';

export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('credit_transactions')
      .select(
        `id, type, amount, balance_after, note, created_at, scan_id,
         scan_log ( id, scan_type, outcome, row_count, retake_count, credits_charged, rows_committed, photo_path )`
      )
      // createServiceClient() bypasses RLS — this filter IS the isolation
      // boundary for this query, not a nice-to-have. Do not remove.
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ ok: true, transactions: data ?? [] });
  } catch (err) {
    console.error('History fetch error:', err);
    return NextResponse.json({ ok: false, error: 'Could not load history' }, { status: 500 });
  }
}
