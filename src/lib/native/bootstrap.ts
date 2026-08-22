'use client';

// Everything in this file is gated behind Capacitor.isNativePlatform() —
// on the regular web app (browser, PWA) every function here is a no-op,
// so this file is safe to import and call unconditionally from anywhere
// without needing separate native/web code paths at the call site.

import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapacitorApp } from '@capacitor/app';

let bootstrapped = false;

// Maps a notification's `data.type` (set by whatever server code called
// sendPushNotification — see pushSender.ts callers) to where tapping it
// should actually land. Add a case here every time a new notification
// trigger is added server-side, or taps just open the app at whatever
// screen it happened to be on last, which defeats the point.
function routeForNotification(data?: Record<string, string>): string | null {
  if (!data?.type) return null;
  switch (data.type) {
    case 'refund_decided':
      return '/credits/refund/history';
    case 'escalation_resolved':
      return '/items'; // where an admin's inventory fix would actually be visible
    case 'billing_confirmed':
      return '/settings';
    default:
      return null;
  }
}

export async function bootstrapNativeApp() {
  if (!Capacitor.isNativePlatform()) return;
  if (bootstrapped) return; // React strict-mode / re-mount safe
  bootstrapped = true;

  await Promise.allSettled([
    requestCameraPermission(),
    setUpPushNotifications(),
    setUpStatusBar(),
    handleBackButton(),
  ]);

  // Hide the native splash screen once the web content underneath is
  // actually ready to show — Capacitor keeps it up by default until
  // told otherwise, which is what gives a real launch-screen feel
  // instead of a flash of blank white before the app loads.
  await SplashScreen.hide().catch(() => {});
}

// The scan feature calls raw getUserMedia for a live camera stream —
// Capacitor's WebView bridge auto-grants that request once the OS
// permission is actually held, but Android 6+ requires an explicit
// runtime prompt first (the manifest entry alone isn't enough). Without
// this, the core "Snap & Go" feature would silently fail to open the
// camera the first time someone uses it in the native app.
async function requestCameraPermission() {
  try {
    const status = await Camera.checkPermissions();
    if (status.camera !== 'granted') {
      await Camera.requestPermissions({ permissions: ['camera'] });
    }
  } catch (err) {
    console.error('Camera permission request failed:', err);
  }
}

// Registers this device for push notifications and forwards the device
// token to the backend so it can actually be targeted later. The
// listeners here only wire up delivery — sending a notification (e.g.
// "your refund was approved") still needs a Firebase project you create
// yourself; see PUSH_NOTIFICATIONS.md for the missing setup step.
async function setUpPushNotifications() {
  try {
    const status = await PushNotifications.checkPermissions();
    let permission = status.receive;
    if (permission === 'prompt') {
      const requested = await PushNotifications.requestPermissions();
      permission = requested.receive;
    }
    if (permission !== 'granted') return;

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token) => {
      // Best-effort — a failed save here doesn't break the app, it just
      // means this device won't receive pushes until it registers again
      // on a later app open.
      fetch('/api/tenant/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value, platform: 'android' }),
      }).catch((err) => console.error('Failed to save push token:', err));
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration failed:', err);
    });

    // Fires when the app was backgrounded or fully closed and the person
    // TAPPED the notification to open it — this is the deep-link case.
    // Full page navigation (window.location) rather than a router push
    // because this listener lives outside the React tree entirely, and
    // because the app may not even be mounted yet when this fires (a
    // cold start from a notification tap).
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data as Record<string, string> | undefined;
      const path = routeForNotification(data);
      if (path) window.location.href = path;
    });

    // Fires when a notification arrives while the app is already open
    // and in the foreground — Android often does NOT also show this in
    // the system tray in that case, so without this the person would
    // see nothing at all until they left and came back. Broadcast a
    // DOM event instead of calling a toast directly, since this file has
    // no access to the React tree/hooks — a small listener component
    // elsewhere in the tree does the actual showing (see AppShell.tsx).
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      window.dispatchEvent(
        new CustomEvent('native-push-received', {
          detail: {
            title: notification.title ?? 'ProfitSnap',
            body: notification.body ?? '',
            data: notification.data,
          },
        })
      );
    });
  } catch (err) {
    console.error('Push notification setup failed:', err);
  }
}

// Matches the app's dark theme (see manifest.json themeColor) so the
// system status bar doesn't show as a jarring default-light bar above a
// dark app — this is a big part of what makes a wrapped web app actually
// feel native instead of feeling like a browser tab.
async function setUpStatusBar() {
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#11131a' });
  } catch (err) {
    // Fails harmlessly on tablets/foldables with edge-to-edge display
    // modes where this API isn't applicable — never worth surfacing.
    console.error('Status bar setup failed:', err);
  }
}

// Without this, Android's hardware back button either closes the app
// unexpectedly from a deep screen, or does nothing — neither feels like
// a real app. This makes it behave like a browser back button first
// (respecting in-app navigation), and only exits the app from the true
// root screen.
async function handleBackButton() {
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapacitorApp.exitApp();
    }
  });
}
