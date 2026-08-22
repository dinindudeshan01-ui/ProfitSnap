// Client-safe credit helpers — formatting only, no database access. Kept
// deliberately separate from lib/credits/engine.ts, which contains the
// actual charge/refund logic and must never be imported into a client
// component (it uses the service-role Supabase client).

import { CreditTransaction } from '@/lib/types';

// Mirrors the constants in lib/credits/engine.ts (server-only). Duplicated
// here as plain numbers — not imported from engine.ts — so client
// components never pull in the service-role Supabase client that engine.ts
// uses. If you change pricing, update both this file and engine.ts.
export const SCAN_BASE_CHARGE = 20; // 20 credits = Rs 5.00 (1 credit = Rs 0.25)
export const RETAKE_CHARGE = 10; // 10 credits = Rs 2.50
export const CREDITS_PER_RUPEE = 4;

export function creditsToRupeesDisplay(credits: number): string {
  return (credits / CREDITS_PER_RUPEE).toFixed(2).replace(/\.00$/, '');
}

export type { CreditTransaction };
