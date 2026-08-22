import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';

// POST /api/tenant/fingerprint  { deviceId: string }
// Called once, right after signup, from the client. Records this tenant's
// device id + signup IP, and checks whether either one already belongs to
// another tenant — if so, flags both for admin review (does NOT block
// signup or tell the tenant anything; see migration-duplicate-detection.sql
// for why this is soft-flag-and-hold rather than auto-block).
export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 128) : null;

  // Standard proxy header chain; take the first (client) hop.
  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : req.headers.get('x-real-ip') || null;

  const db = createServiceClient();

  await db
    .from('tenants')
    .update({ signup_device_id: deviceId, signup_ip: ip })
    .eq('id', tenantId);

  if (!deviceId && !ip) {
    return NextResponse.json({ ok: true, flagged: false });
  }

  // Find OTHER tenants sharing this device id or IP. Both is a stronger
  // signal than either alone, but either alone is still worth a review —
  // it's a flag queue, not an auto-penalty, so false positives just cost
  // an admin a few seconds to dismiss.
  let query = db
    .from('tenants')
    .select('id, signup_device_id, signup_ip')
    .neq('id', tenantId);

  if (deviceId && ip) {
    query = query.or(`signup_device_id.eq.${deviceId},signup_ip.eq.${ip}`);
  } else if (deviceId) {
    query = query.eq('signup_device_id', deviceId);
  } else if (ip) {
    query = query.eq('signup_ip', ip);
  }

  const { data: matches } = await query.limit(10);
  if (!matches || matches.length === 0) {
    return NextResponse.json({ ok: true, flagged: false });
  }

  const flags = matches.map((m) => {
    const deviceMatch = deviceId && m.signup_device_id === deviceId;
    const ipMatch = ip && m.signup_ip === ip;
    return {
      tenant_id: tenantId,
      matched_tenant_id: m.id,
      match_reason: deviceMatch && ipMatch ? 'both' : deviceMatch ? 'device' : 'ip',
      status: 'pending',
      credits_held: true,
    };
  });

  await db.from('tenant_duplicate_flags').insert(flags);

  return NextResponse.json({ ok: true, flagged: true });
}
