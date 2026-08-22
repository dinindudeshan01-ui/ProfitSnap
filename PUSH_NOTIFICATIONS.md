# Push notifications — setup checklist

The code side is done (device registration, token storage, the send
helper, and it's already wired to fire when a refund is approved/denied).
What's left is entirely account setup on your end — I can't create a
Firebase project for you.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com → **Add project**.
2. Any name is fine — it doesn't have to match "ProfitSnap".

## 2. Add an Android app to it
1. In the Firebase project → **Add app** → Android.
2. **Package name must be exactly** `lk.profitsnap.app` — this has
   to match `appId` in `capacitor.config.ts`. If you ever change one,
   change both.
3. Download the `google-services.json` file it gives you.
4. Place that file at `android/app/google-services.json` in this
   project (same folder as `android/app/build.gradle`).

## 3. Get a service account key (for the server to send notifications)
1. In Firebase → Project settings (gear icon) → **Service accounts** tab.
2. Click **Generate new private key** — downloads a JSON file.
3. **Never commit this file to git.** Open it, copy its entire contents
   as a single line, and set it as an environment variable:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the full JSON content
   - `FIREBASE_PROJECT_ID` = the `project_id` field from that same file
4. Add both to wherever you deploy the app (Vercel → Project Settings →
   Environment Variables), and to your local `.env.local` for testing.

## 4. That's it for Gradle — it's automatic
Capacitor's Android template already includes the Google services plugin
and applies it automatically the moment `google-services.json` exists in
`android/app/` — there's nothing to manually edit in any `.gradle` file.
Just placing the file there (step 2 above) is enough.

## 5. That's it — verify it worked
Once you've built and installed the app on a real device (see
`BUILD_ANDROID.md`):
1. Open the app, allow the notification permission prompt.
2. Check the `push_tokens` table in Supabase — a row should appear for
   that tenant within a few seconds.
3. Trigger a real approve/deny on a refund request in the admin panel —
   a notification should arrive on the device within a few seconds.

If nothing arrives: check your server logs for `FCM send failed` or
`Failed to get Firebase access token` — those come straight from
`src/lib/native/pushSender.ts` and will tell you exactly which of the
steps above is missing or wrong.
