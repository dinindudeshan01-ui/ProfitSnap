'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import BottomTabBar from './BottomTabBar';
import NavProgress from './NavProgress';
import OfflineBanner from './OfflineBanner';
import TrialEndedBanner from './TrialEndedBanner';
import { createClient } from '@/lib/supabase/client';
import { bootstrapNativeApp } from '@/lib/native/bootstrap';
import { useToast } from '@/components/Toast';

const NO_TAB_BAR_ROUTES = ['/setup', '/scan', '/reset-password', '/terms', '/privacy'];

// The admin panel has its own full-width layout and its own server-side
// auth guard (src/app/admin/layout.tsx) — it must bypass this component's
// mobile "app shell" container entirely, not just skip the tab bar.
const SELF_GATED_PREFIXES = ['/admin'];
// Reachable without an ordinary tenant session — the login page itself,
// the password-reset landing page, which establishes its own
// short-lived recovery session independently of the normal auth check
// below (that check would otherwise race the token exchange and bounce
// the person to /login before the reset form ever renders), and the
// static Terms/Privacy pages linked from the signup checkbox (opened in
// a new tab before an account exists).
const PUBLIC_ROUTES = ['/login', '/reset-password', '/terms', '/privacy'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const isAdmin = SELF_GATED_PREFIXES.some((p) => pathname.startsWith(p));
  const isPublic = PUBLIC_ROUTES.includes(pathname);
  const showTabBar = !NO_TAB_BAR_ROUTES.some((r) => pathname.startsWith(r));

  const [checked, setChecked] = useState(isPublic);
  const showToast = useToast();

  // Runs once per app load, native-only (no-op on web) — see
  // bootstrap.ts for why each piece exists. Deliberately separate from
  // the auth-check effect below so it fires immediately regardless of
  // login state (splash screen, status bar, and back-button handling all
  // matter before/without a session too).
  useEffect(() => {
    bootstrapNativeApp();
  }, []);

  // A push notification that arrives while the app is already open often
  // doesn't also show up in the system tray (Android's default
  // behavior), so without this the person would see nothing until they
  // left and came back. bootstrap.ts broadcasts this event (it has no
  // access to React hooks/context itself); this is just the listener
  // that turns it into something visible.
  useEffect(() => {
    function handleNativePush(e: Event) {
      const detail = (e as CustomEvent<{ title: string; body: string }>).detail;
      if (detail?.body) showToast(`${detail.title}: ${detail.body}`);
    }
    window.addEventListener('native-push-received', handleNativePush);
    return () => window.removeEventListener('native-push-received', handleNativePush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPublic || isAdmin) {
      setChecked(true);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      if (!user) {
        router.replace('/login');
        return;
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, isPublic, isAdmin, router]);

  // Admin has its own full-width layout + auth — render it untouched.
  if (isAdmin) return <>{children}</>;

  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-md flex-col bg-bg shadow-xl">
      <OfflineBanner />
      {!isPublic && pathname !== '/settings' && <TrialEndedBanner />}
      <NavProgress />
      <div className="no-scrollbar flex-1 overflow-y-auto">{checked ? children : null}</div>
      {showTabBar && checked && !isPublic && <BottomTabBar />}
    </div>
  );
}
