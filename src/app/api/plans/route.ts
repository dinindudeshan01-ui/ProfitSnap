import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/plans — public, used by the signup form's plan picker (before
// the tenant has a session). Deliberately minimal fields, active plans
// only — this is not the admin catalog endpoint.
export async function GET() {
  const db = createServiceClient();
  const { data, error } = await db
    .from('plans')
    .select('id, name, price_amount, currency, billing_period, credits_included, scan_limit_per_month, features')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ plans: data ?? [] });
}
