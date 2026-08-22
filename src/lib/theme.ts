// Design tokens — ported 1:1 from the original Expo app's src/theme/tokens.js
// so the web version keeps the exact same brand identity.
//
// `home` / `homeLight` resolve to `var(--color-home)` / `var(--color-home-light)`
// rather than a fixed hex string, so every screen that reads `colors.home`
// picks up the tenant's chosen brand color (see brandColor.ts) automatically.
// This is a static string — identical on server and client — so it never
// causes a hydration mismatch; the actual color resolution happens purely
// in the browser's CSS engine, live, with no JS re-render needed when the
// CSS variable changes.
import { DEFAULT_HOME, DEFAULT_HOME_LIGHT } from './brandColor';

export const colors = {
  white: '#FFFFFF',
  bg: '#F2F4F8',
  text: '#1A1A2E',
  sub: '#6B7280',
  border: '#E5E7EB',

  get home() {
    return `var(--color-home, ${DEFAULT_HOME})`;
  },
  get homeLight() {
    return `var(--color-home-light, ${DEFAULT_HOME_LIGHT})`;
  },

  products: '#00B87C',
  productsLight: '#E6FAF4',

  sales: '#FF6B35',
  salesLight: '#FFF1EC',

  stock: '#0099CC',
  stockLight: '#E6F6FC',

  profit: '#9B59B6',
  profitLight: '#F5EEF8',

  credits: '#D4A017',
  creditsLight: '#FBF3DD',

  creditSale: '#0D9488',
  creditSaleLight: '#E4F5F3',

  danger: '#EF4444',
};

// Unit -> accent color map (drives icon + badge color), ported 1:1.
export const UNIT_COLORS: Record<string, string> = {
  pcs: '#6C63FF',
  kg: '#00B87C',
  g: '#00B87C',
  L: '#0099CC',
  ml: '#0099CC',
  m: '#FF6B35',
  packet: '#9B59B6',
  box: '#E67E22',
  pair: '#E91E63',
  set: '#795548',
  dozen: '#16A085',
  bag: '#2E86C1',
};

export function unitColor(unit: string): string {
  return UNIT_COLORS[unit] || colors.sub;
}

export const UNITS = [
  'pcs', 'kg', 'g', 'L', 'ml', 'm', 'packet', 'box', 'pair', 'set', 'dozen', 'bag',
] as const;
