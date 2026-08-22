// Runtime brand-color theming. The tenant's brand_color (set in Settings)
// overrides the app's --color-home / --color-home-light CSS variables at
// runtime, on top of the static defaults in globals.css. theme.ts reads
// these same variables via getters, so every existing `colors.home` /
// `colors.homeLight` usage across the app updates automatically — no need
// to touch each screen individually.

export const DEFAULT_HOME = '#6C63FF';
export const DEFAULT_HOME_LIGHT = '#EEF0FF';
export const BRAND_COLOR_STORAGE_KEY = 'profitsnap_brand_color';

// Mixes a hex color toward white — used to derive the "light" tint variant
// (e.g. #6C63FF -> #EEF0FF) from whatever single brand_color the tenant
// picks, since we only store one color, not a full palette.
export function lightenHex(hex: string, ratio = 0.88): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return DEFAULT_HOME_LIGHT;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

// Applies a brand color to the live document (CSS vars) and caches it so
// the next page load can apply it before first paint (see the inline
// script in layout.tsx) instead of flashing the default purple first.
export function applyBrandColor(hex: string) {
  if (typeof document === 'undefined') return;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  document.documentElement.style.setProperty('--color-home', hex);
  document.documentElement.style.setProperty('--color-home-light', lightenHex(hex));
  try {
    localStorage.setItem(BRAND_COLOR_STORAGE_KEY, hex);
  } catch {
    // Storage can fail in private browsing — theming still works for this
    // session via the CSS var, it just won't persist across reloads.
  }
}

export function getCachedBrandColor(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(BRAND_COLOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Inline script source injected into <head> so returning visitors get their
// brand color applied before React hydrates — avoids a flash of the
// default purple on every navigation/reload. Kept as a plain string (not a
// module import) since it has to run as a raw <script> tag.
export const BRAND_COLOR_INIT_SCRIPT = `
(function () {
  try {
    var c = localStorage.getItem('${BRAND_COLOR_STORAGE_KEY}');
    if (c && /^#[0-9a-f]{6}$/i.test(c)) {
      var num = parseInt(c.slice(1), 16);
      var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
      var mix = function (ch) { return Math.round(ch + (255 - ch) * 0.88); };
      var toHex = function (n) { return n.toString(16).padStart(2, '0'); };
      var light = '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
      document.documentElement.style.setProperty('--color-home', c);
      document.documentElement.style.setProperty('--color-home-light', light);
    }
  } catch (e) {}
})();
`;
