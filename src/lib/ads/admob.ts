// AdMob wrapper — every ad call in the app goes through here so ad logic
// stays in one place and free-vs-paid gating can never be forgotten at a
// call site.
//
// SETUP NEEDED BEFORE ADS SHOW ANYTHING (none of this works yet without it):
//   1. Create an AdMob account (admob.google.com), add the app, get an
//      App ID for Android.
//   2. Put the App ID in android/app/src/main/AndroidManifest.xml under
//      <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID">
//   3. Create ad units (Banner, Interstitial, Rewarded) in the AdMob
//      console, then fill in the env vars below.
//   4. `npm install` — @capacitor-community/admob is already added to
//      package.json — then `npx cap sync android`.
// Until then, every function here is a safe no-op (logged to console),
// so the rest of the app (plan gating, placement calls) can be wired and
// tested without a live AdMob account.

const AD_UNIT_BANNER = process.env.NEXT_PUBLIC_ADMOB_BANNER_ID || '';
const AD_UNIT_INTERSTITIAL = process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ID || '';
const AD_UNIT_REWARDED = process.env.NEXT_PUBLIC_ADMOB_REWARDED_ID || '';

// Google's official test ad unit IDs — safe to ship in dev builds, never
// in the production APK (using them in prod risks an AdMob policy strike).
const TEST_BANNER = 'ca-app-pub-3940256099942544/6300978111';
const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/1033173712';
const TEST_REWARDED = 'ca-app-pub-3940256099942544/5224354917';

function isNative(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

async function loadAdMob() {
  if (!isNative()) return null;
  try {
    // Dynamic import so a web build (no Capacitor native runtime) never
    // even tries to resolve the native-only plugin.
    const mod = await import('@capacitor-community/admob');
    return mod;
  } catch {
    console.warn('[ads] @capacitor-community/admob not installed yet — run npm install.');
    return null;
  }
}

let initialized = false;
export async function initAds() {
  const mod = await loadAdMob();
  if (!mod || initialized) return;
  await mod.AdMob.initialize({ testingDevices: [], initializeForTesting: !AD_UNIT_BANNER });
  initialized = true;
}

// Persistent banner — call once per screen mount. `position` matches the
// product ask for "upper and bottom ads": call this twice per screen, once
// with TOP_CENTER and once with BOTTOM_CENTER, on any screen a free-tier
// user sees.
export async function showBanner(position: 'TOP_CENTER' | 'BOTTOM_CENTER') {
  const mod = await loadAdMob();
  if (!mod) return;
  await initAds();
  await mod.AdMob.showBanner({
    adId: AD_UNIT_BANNER || TEST_BANNER,
    adSize: mod.BannerAdSize.ADAPTIVE_BANNER,
    position: position === 'TOP_CENTER' ? mod.BannerAdPosition.TOP_CENTER : mod.BannerAdPosition.BOTTOM_CENTER,
    isTesting: !AD_UNIT_BANNER,
  });
}

export async function hideBanner() {
  const mod = await loadAdMob();
  if (!mod) return;
  await mod.AdMob.hideBanner().catch(() => {});
}

// Interstitial — call between a scan result screen and the next screen
// (e.g. after "Save" on a confirmed scan), NOT mid-task, so it never
// interrupts something the user is actively doing.
export async function showInterstitial() {
  const mod = await loadAdMob();
  if (!mod) return;
  await initAds();
  await mod.AdMob.prepareInterstitial({ adId: AD_UNIT_INTERSTITIAL || TEST_INTERSTITIAL, isTesting: !AD_UNIT_INTERSTITIAL });
  await mod.AdMob.showInterstitial();
}

// Rewarded ad — "watch an ad, get 5 free credits". Returns true only if
// the user actually watched to completion (AdMob reports this itself; we
// never grant the reward speculatively).
export async function showRewarded(): Promise<boolean> {
  const mod = await loadAdMob();
  if (!mod) return false;
  await initAds();
  await mod.AdMob.prepareRewardVideoAd({ adId: AD_UNIT_REWARDED || TEST_REWARDED, isTesting: !AD_UNIT_REWARDED });
  const result = await mod.AdMob.showRewardVideoAd();
  return !!result; // plugin resolves the promise with reward info on completion, rejects/never-resolves on skip
}
