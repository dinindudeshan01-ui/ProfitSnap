'use client';

// Ported from the Expo app's src/i18n/LangContext.js. The original stored
// nothing persistent (language reset to 'en' on every app launch, unless
// a screen wrote it to settings); here we persist to localStorage so a
// returning visitor keeps their language choice — closer to what the
// mobile rebuild will eventually do via the `settings` table.

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { LANGS, LangDef } from './langs';

interface LangContextValue {
  langCode: string;
  setLang: (code: string) => void;
  lang: LangDef;
  t: Record<string, string>;
  dir: 'ltr' | 'rtl';
  isRTL: boolean;
  LANGS: typeof LANGS;
}

const LangContext = createContext<LangContextValue | null>(null);
const STORAGE_KEY = 'profitsnap_lang';

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [langCode, setLangCode] = useState('en');

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored && LANGS[stored]) setLangCode(stored);
  }, []);

  const setLang = useCallback((code: string) => {
    if (LANGS[code]) {
      setLangCode(code);
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, code);
    }
  }, []);

  const lang = LANGS[langCode] || LANGS.en;

  const value: LangContextValue = {
    langCode,
    setLang,
    lang,
    t: lang.t,
    dir: lang.dir,
    isRTL: lang.dir === 'rtl',
    LANGS,
  };

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

// Usage: const { t } = useLang(); t.myItems
export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LangProvider');
  return ctx;
}
