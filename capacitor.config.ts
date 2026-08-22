import type { CapacitorConfig } from '@capacitor/cli';

// IMPORTANT — read before building:
//
// This app has real server-side API routes (Supabase calls, the OCR
// pipeline, admin endpoints) — it is NOT a static site, so Capacitor
// can't bundle it as local files the way a plain React/Vue SPA would be
// bundled. Instead this uses Capacitor's "live server" pattern: the
// Android WebView loads your app from a real deployed URL, the same way
// a mobile browser would, just wrapped in a native shell with native
// APIs (push notifications, status bar, etc.) layered on top.
//
// That means: DEPLOY THE APP FIRST (e.g. to Vercel), then replace the
// placeholder URL below with your real one, before building the APK.
// Building against localhost only works on an emulator on the same
// machine — it will not work on a real phone.
const config: CapacitorConfig = {
  appId: 'lk.profitsnap.app',
  appName: 'ProfitSnap',
  webDir: 'public', // unused in server-url mode but required by the CLI
  server: {
    url: 'https://profitsnap-lk.vercel.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
