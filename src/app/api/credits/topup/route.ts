// POST /api/credits/topup
// Dev/testing-only "add credits" action — stands in for a real payment
// gateway. Every top-up is logged in the same ledger as everything else,
// so the history view doesn't need to special-case it.
//
// Body: { amount: number }

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { addTopup } from '@/lib/credits/engine';

const MAX_TOPUP = 100000; // sanity ceiling for the dev/testing top-up button

export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { amount } = await req.json();
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: 'amount must be a positive number' }, { status: 400 });
    }
    if (amount > MAX_TOPUP) {
      return NextResponse.json({ ok: false, error: `amount must be at most ${MAX_TOPUP}` }, { status: 400 });
    }

    const supabase = createServiceClient();
    const result = await addTopup(supabase, tenantId, Math.round(amount), 'Manual top-up (testing)');

    return NextResponse.json({ ok: true, balance: result.balanceAfter });
  } catch (err) {
    console.error('Topup error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
