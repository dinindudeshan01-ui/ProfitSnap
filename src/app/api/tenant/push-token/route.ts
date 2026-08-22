import { NextRequest, NextResponse } from 'next/server';
import { createTenantAwareClient } from '@/lib/supabase/server';

// POST /api/tenant/push-token
// Called once by src/lib/native/bootstrap.ts every time the native app
// registers for push notifications (app install, reinstall, or token
// refresh). Just stores the token against the logged-in tenant — sending
// an actual notification is a separate, admin/backend-triggered step
// (see PUSH_NOTIFICATIONS.md for what's still needed there).
export async function POST(req: NextRequest) {
  const supabase = await createTenantAwareClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token, platform } = await req.json();
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }
  if (platform !== 'android' && platform !== 'ios') {
    return NextResponse.json({ error: 'platform must be android or ios' }, { status: 400 });
  }

  const { error } = await supabase.from('push_tokens').upsert(
    { tenant_id: user.id, token, platform },
    { onConflict: 'tenant_id,token' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
