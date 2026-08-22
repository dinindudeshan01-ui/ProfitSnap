'use client';

// AdGate — drop this once near the root layout (or per-screen if you want
// finer control) and it handles the "free users see ads, Pro users don't"
// rule in exactly one place. Shows a native top banner + bottom banner via
// AdMob (see src/lib/ads/admob.ts) whenever the tenant has no active paid
// plan. Paid subscribers (any active row in tenant_subscriptions with
// price_amount > 0) never see a banner — that's part of what they're
// paying for, and it's the difference between "ad-supported" and "feels
// like it's full of ads": free users get exactly one banner top + one
// bottom, persistent, never a popup mid-task. Interstitials (showInterstitial
// in admob.ts) are called separately, right after a scan is saved — not
// from here — so they don't fire on every screen mount.

import { useEffect, useState } from 'react';
import { showBanner, hideBanner } from '@/lib/ads/admob';

export function AdGate() {
  const [isFree, setIsFree] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/billing')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const activePlanPrice = data?.currentSub?.plans?.price_amount ?? 0;
        setIsFree(activePlanPrice <= 0);
      })
      .catch(() => setIsFree(null)); // unknown -> don't show ads rather than risk showing them to a paid user on a transient error
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isFree === true) {
      showBanner('TOP_CENTER');
      showBanner('BOTTOM_CENTER');
    } else {
      hideBanner();
    }
    return () => {
      hideBanner();
    };
  }, [isFree]);

  return null; // banners render as native overlays, not DOM — nothing to return here
}
