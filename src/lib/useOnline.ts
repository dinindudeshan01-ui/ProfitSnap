'use client';

import { useEffect, useState } from 'react';

// Tracks browser connectivity via the online/offline events, which cover
// the common case (wifi/data actually dropped) — it won't catch every
// failure mode (e.g. connected but the Supabase/Gemini endpoint itself is
// down), but that's what the per-request try/catch error messages are
// for. This is specifically for the "I have no signal at all" case that
// used to just hang or fail with a confusing generic error.
export function useOnline() {
  // Assume online during SSR/initial render — navigator isn't available
  // server-side, and guessing "online" is the safer default (worst case
  // shows a normal loading state for a moment instead of a false
  // "you're offline" flash on a perfectly fine connection).
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
