import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-side client using the service role key — used only inside API
// routes (e.g. /api/scan) for writing the scan_log audit trail and uploading
// photos to Storage. Bypasses RLS entirely, so every call site using this
// client MUST filter/insert on tenant_id itself — the database will not
// stop it from touching another tenant's rows. Never import this into
// client components.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Cookie-based client for API routes that need to know WHO is calling.
// Reads the logged-in Supabase Auth session from cookies, same pattern as
// /api/tenant/billing/[action]/route.ts. tenants.id === auth.users.id, so
// the resolved user id IS the tenant id.
export async function createTenantAwareClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // ignore in Server Component render
          }
        },
      },
    }
  );
}

// Resolves the current request's tenantId (== auth.users.id).
//
// Two auth paths, checked in order:
//  1. Authorization: Bearer <access_token> — used by the native Android
//     app, which has no browser cookie jar and instead sends the Supabase
//     session token it got from GoTrue at sign-in (see SessionStore.kt /
//     AuthRepository.kt in android-native). Verified via Supabase's own
//     getUser(jwt), so this is exactly as trustworthy as a cookie session.
//  2. Cookie-based session — the existing web app flow, unchanged.
//
// Returns null if neither resolves to a user — callers should respond 401
// rather than falling through to an untenanted operation.
export async function getRequestTenantId(req?: Request): Promise<string | null> {
  const authHeader = req?.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length);
    const anonClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await anonClient.auth.getUser(token);
    if (data.user) return data.user.id;
    // Falls through to cookie check below rather than failing outright —
    // an expired/bad bearer token shouldn't break a browser request that
    // happens to also carry some unrelated Authorization header.
  }

  const supabase = await createTenantAwareClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
