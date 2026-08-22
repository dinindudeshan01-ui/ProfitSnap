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

// Resolves the current request's tenantId (== auth.users.id) from cookies.
// Returns null if there's no logged-in session — callers should respond
// 401 in that case rather than falling through to an untenanted operation.
export async function getRequestTenantId(): Promise<string | null> {
  const supabase = await createTenantAwareClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
