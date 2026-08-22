// GET /api/credits/balance
import { NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import { getBalance } from '@/lib/credits/engine';

export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const balance = await getBalance(supabase, tenantId);
    return NextResponse.json({ ok: true, balance });
  } catch (err) {
    console.error('Balance fetch error:', err);
    const message = err instanceof Error ? err.message : 'Could not load balance';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
