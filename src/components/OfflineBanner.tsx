'use client';

import { WifiOff } from 'lucide-react';
import { useOnline } from '@/lib/useOnline';

// Mounted once in the root layout, above everything else — every screen
// gets this for free instead of each one needing its own connectivity
// check. This alone doesn't stop someone from tapping Save while
// offline (per-action guards handle that, since the banner could be
// missed) — it's the constant, unmissable signal that something is
// currently wrong with the connection, not just this one action.
export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-white">
      <WifiOff size={14} />
      You&apos;re offline — some actions won&apos;t work until you&apos;re back online
    </div>
  );
}
