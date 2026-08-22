import { createBrowserClient } from '@supabase/ssr';

// Session-aware browser client — every tenant CRUD call (products, sales,
// stock_in, settings, scans) goes through this, and relies on the logged-in
// user's session for RLS (tenant_id = auth.uid()) to pass. See /login for
// where that session gets established.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
