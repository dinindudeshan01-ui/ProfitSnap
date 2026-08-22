'use client';

// The Setup screen lets a tenant pick a currency symbol (Rs, ₹, $, AED,
// SAR, ₩, €, £) and saves it to settings.currency — but until this file,
// nothing else in the app read that value back. Every screen hardcoded
// "Rs", so a non-Sri-Lankan shop saw the wrong symbol everywhere. This
// context fetches the real value once and every money display should go
// through it instead of hardcoding a symbol.

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSetting } from '@/lib/db/queries';

interface CurrencyContextValue {
  currency: string;
  setCurrency: (value: string) => void;
  formatMoney: (amount: number, opts?: { decimals?: number }) => string;
}

const DEFAULT_CURRENCY = 'Rs';
const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const value = await getSetting(supabase, 'currency');
        if (!cancelled && value) setCurrencyState(value);
      } catch {
        // Not logged in yet, no tenant, or offline — default symbol stays
        // in effect; this is never worth surfacing as an error to the user.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lets a screen (e.g. Settings) update the symbol immediately after
  // saving, the same way BrandThemeSync/applyBrandColor updates live
  // without waiting for a reload.
  const setCurrency = useCallback((value: string) => {
    setCurrencyState(value || DEFAULT_CURRENCY);
  }, []);

  const formatMoney = useCallback(
    (amount: number, opts?: { decimals?: number }) => {
      const decimals = opts?.decimals ?? (Number.isInteger(amount) ? 0 : 2);
      return `${currency} ${amount.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    },
    [currency]
  );

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatMoney }}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within a CurrencyProvider');
  return ctx;
}
