import { NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';

// GET /api/tenant/shop-id
// Deliberately tiny and separate from /api/tenant/profile — this badge is
// meant to show up on Home even when other data (items, sales, credits)
// fails to load, so support can always ask "what's your shop ID" over the
// phone regardless of what else is broken.
export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) return NextResponse.json({ shopNo: null }, { status: 401 });

  const db = createServiceClient();
  const { data } = await db.from('tenants').select('shop_no').eq('id', tenantId).maybeSingle();
  return NextResponse.json({ shopNo: data?.shop_no ?? null });
}
