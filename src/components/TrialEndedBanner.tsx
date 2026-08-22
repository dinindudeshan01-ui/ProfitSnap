'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Deliberately no close/dismiss button — the point is a persistent
// reminder, not a one-time notice someone can tap away and forget. It
// only ever gates the AI scan feature in its own wording, never implies
// the rest of the app stops working — recording sales, adding items
// manually, and everything offline all keep working on the free plan
// indefinitely; only new AI Snaps need an active paid plan once the
// trial's credits/period are gone.
export default function TrialEndedBanner() {
  const router = useRouter();
  const [trialEnded, setTrialEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tenant/trial-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.trialEnded) setTrialEnded(true);
      })
      .catch(() => {
        // Silent — a failed check just means the banner doesn't show
        // this load; it's a nudge, not something worth erroring over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trialEnded) return null;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2.5 text-white">
      <p className="text-xs font-semibold leading-tight">
        Your free trial has ended — upgrade to keep using AI Snaps. Recording sales, adding items
        manually, and everything offline still works free.
      </p>
      <button
        onClick={() => router.push('/settings')}
        className="shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold hover:bg-white/30"
      >
        Upgrade
      </button>
    </div>
  );
}
