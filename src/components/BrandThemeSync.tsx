'use client';

import { useEffect } from 'react';
import { applyBrandColor, getCachedBrandColor } from '@/lib/brandColor';

// Fetches the logged-in tenant's brand_color and applies it as a CSS
// variable. The inline script in layout.tsx already applied any *cached*
// color before first paint (no flash on repeat visits); this reconciles
// against the real value from the DB and updates the cache for next time.
//
// No remount/re-render trick needed here: colors.home resolves to
// `var(--color-home)` (see theme.ts), so changing the CSS variable repaints
// every consumer live, purely at the CSS layer.
export default function BrandThemeSync({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      try {
        const res = await fetch('/api/tenant/profile');
        if (!res.ok) return; // not logged in, or no tenant yet — keep default
        const body = await res.json();
        const brandColor: string | undefined = body?.tenant?.brand_color;
        if (!brandColor || cancelled) return;

        if (getCachedBrandColor() !== brandColor) {
          applyBrandColor(brandColor);
        }
      } catch {
        // Offline or API hiccup — cached/default color stays in effect.
      }
    }

    sync();
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
