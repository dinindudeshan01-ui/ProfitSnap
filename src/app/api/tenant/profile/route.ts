import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Session-scoped client for the customer-facing app — relies entirely on
// RLS (tenant_id = auth.uid()) for isolation, same as the rest of the app.
async function createTenantClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component render — ignore, middleware refreshes session.
        }
      },
    },
  });
}

export async function GET() {
  const supabase = await createTenantClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('tenants').select('*').eq('id', user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data });
}

export async function PATCH(req: Request) {
  const supabase = await createTenantClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const update: Record<string, unknown> = {};

  if (typeof body.business_name === 'string') {
    if (!body.business_name.trim()) {
      return NextResponse.json({ error: 'Business name cannot be empty' }, { status: 400 });
    }
    update.business_name = body.business_name.trim();
  }
  if (typeof body.brand_color === 'string') {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.brand_color)) {
      return NextResponse.json({ error: 'brand_color must be a hex value like #6C63FF' }, { status: 400 });
    }
    update.brand_color = body.brand_color;
  }
  if (typeof body.is_registered === 'boolean') {
    update.is_registered = body.is_registered;
    // Clearing registration status clears the number too — no stale reg
    // no. left behind once a business says "no, not registered".
    if (!body.is_registered) update.registration_no = null;
  }
  if (typeof body.registration_no === 'string') {
    update.registration_no = body.registration_no.trim() || null;
  }
  if (typeof body.district === 'string') {
    update.district = body.district.trim() || null;
  }
  if (typeof body.owner_name === 'string') {
    update.owner_name = body.owner_name.trim() || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('tenants')
    .update(update)
    .eq('id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tenant: data });
}
