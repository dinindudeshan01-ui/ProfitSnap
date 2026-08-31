'use client';

import { useEffect } from 'react';

// Registers the offline app-shell service worker (public/sw.js). Mounted
// once in the root layout. Silently no-ops in browsers/environments
// without SW support instead of throwing.
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  return null;
}
