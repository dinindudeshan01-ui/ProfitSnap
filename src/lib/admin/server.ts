import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient } from '../supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

// Session-aware server client — reads the logged-in admin's cookie so
// `auth.uid()` is populated inside RLS policies. Used for anything that
// should respect is_admin() rather than bypass RLS outright.
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — safe to ignore since
            // middleware refreshes the session on the next request.
          }
        },
      },
    }
  );
}

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
  role: 'support' | 'finance' | 'superadmin';
}

// Returns the current admin's identity, or null if not logged in / not an
// admin. Every /admin page and /api/admin route should call this first —
// never trust the client, always re-check server-side even though RLS is
// also enforcing it at the DB layer.
export async function requireAdmin(): Promise<AdminIdentity | null> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('id, name, email, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!adminRow) return null;
  return adminRow as AdminIdentity;
}

// Service-role client for the rare cases an admin screen legitimately needs
// to read across all tenants in one query (e.g. global search, dashboard
// aggregates). Every call site MUST explicitly scope by tenant_id itself
// when displaying a single customer's data — this client bypasses RLS
// entirely, so the query, not Postgres, is now the isolation boundary.
export function createAdminServiceClient(): SupabaseClient {
  return createServiceClient();
}

// Every sensitive admin action (adjustment, suspend, impersonate, note)
// must call this. Writes to admin_audit_log via the session client so
// admin_id/admin_email are always attributable to who actually did it.
export async function logAdminAction(
  admin: AdminIdentity,
  action: string,
  tenantId: string | null,
  details?: Record<string, unknown>
) {
  const supabase = await createSessionClient();
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_id: admin.id,
    admin_email: admin.email,
    action,
    tenant_id: tenantId,
    details: details ?? null,
  });
  if (error) {
    // Never let an audit-log failure silently swallow the action's error,
    // but also never block the action on a logging hiccup — surface it
    // loudly server-side so it gets noticed.
    console.error(`[admin_audit_log] failed to record "${action}":`, error);
  }
}
