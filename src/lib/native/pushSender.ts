// Sends a push notification to a tenant's registered device(s) via
// Firebase Cloud Messaging (FCM) HTTP v1 API.
//
// ⚠ REQUIRES SETUP YOU HAVE TO DO — this file can't work until you:
//   1. Create a Firebase project (console.firebase.google.com) — free tier.
//   2. Add an Android app to it with package name com.weertech.profitsnap
//      (must match capacitor.config.ts's appId exactly).
//   3. Download google-services.json from Firebase and place it at
//      android/app/google-services.json (see PUSH_NOTIFICATIONS.md).
//   4. In Firebase project settings → Service accounts → generate a new
//      private key. That JSON file's contents go into the
//      FIREBASE_SERVICE_ACCOUNT_JSON environment variable (as a single-
//      line JSON string) — never commit that file to git.
//
// Until that's done, sendPushNotification() below will just log an error
// and return false — it never throws, so nothing that calls it (e.g. a
// refund-approved notification) can break the actual action it's
// attached to just because push isn't configured yet.

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error('Push notification not sent: FIREBASE_SERVICE_ACCOUNT_JSON is not set.');
    return null;
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const client = await auth.getClient();
    const { token, res } = await client.getAccessToken();
    if (!token) return null;
    const expiresAt = res?.data?.expiry_date ?? Date.now() + 55 * 60_000;
    cachedAccessToken = { token, expiresAt };
    return token;
  } catch (err) {
    console.error('Failed to get Firebase access token:', err);
    return null;
  }
}

// Sends to every token registered for a tenant (multiple devices). Never
// throws — returns how many sends actually succeeded, so a caller can
// decide whether that's worth surfacing, but a push failure should never
// be the reason a refund approval or any other real action fails.
export async function sendPushNotification(
  db: { from: (table: string) => any },
  tenantId: string,
  payload: PushPayload
): Promise<{ sent: number; total: number }> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error('Push notification not sent: FIREBASE_PROJECT_ID is not set.');
    return { sent: 0, total: 0 };
  }

  const { data: tokens } = await db.from('push_tokens').select('token').eq('tenant_id', tenantId);
  const tokenList: string[] = (tokens ?? []).map((t: { token: string }) => t.token);
  if (tokenList.length === 0) return { sent: 0, total: 0 };

  const accessToken = await getAccessToken();
  if (!accessToken) return { sent: 0, total: tokenList.length };

  let sent = 0;
  for (const token of tokenList) {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data ?? {},
          },
        }),
      });
      if (res.ok) sent++;
      else console.error('FCM send failed:', await res.text());
    } catch (err) {
      console.error('FCM send error:', err);
    }
  }

  return { sent, total: tokenList.length };
}
