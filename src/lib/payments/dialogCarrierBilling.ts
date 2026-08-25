// Dialog Direct Carrier Billing — GSMA Open Gateway / CAMARA Carrier
// Billing API. This is a SEPARATE integration from Google Play Billing
// (see billingRepository in android-native) — this one charges a
// subscriber's Dialog mobile account directly from the *web* app, for
// users paying without going through an app store.
//
// ⚠️ SCAFFOLD, NOT LIVE — this cannot actually charge anyone yet.
// Before this works, you need to:
//   1. Register as a developer on Dialog's Open Gateway / Ideamart portal
//      (https://open-gateway.dialog.lk or via Axonect — the exact portal
//      URL/name may have changed since this was written; search "Dialog
//      Open Gateway developer" or "Dialog Ideamart Axonect" if the link
//      is stale).
//   2. Complete their merchant/business verification (KYC) — this is a
//      real business process, not something that can be automated here.
//   3. Get sandbox credentials first, test the full charge + webhook
//      flow, THEN request production credentials.
//   4. Set DIALOG_CARRIER_BILLING_CLIENT_ID/SECRET/API_BASE_URL once
//      issued.
//
// The CAMARA Carrier Billing API (the standard this is built against) is
// public spec: https://github.com/camaraproject/CarrierBilling — the
// shapes below follow that spec's charge-request/response structure, but
// the exact auth flow and base URL are Dialog-specific and only Dialog
// can give you those once you're registered.

const CLIENT_ID = process.env.DIALOG_CARRIER_BILLING_CLIENT_ID;
const CLIENT_SECRET = process.env.DIALOG_CARRIER_BILLING_CLIENT_SECRET;
const API_BASE_URL = process.env.DIALOG_CARRIER_BILLING_API_BASE_URL;

export function isDialogCarrierBillingConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && API_BASE_URL);
}

interface ChargeRequest {
  msisdn: string; // subscriber's phone number, e.g. "+94771234567"
  amount: number;
  currency: string; // "LKR"
  reference: string; // your own order id, e.g. "sub_123"
  description: string;
}

interface ChargeResult {
  transactionId: string;
  status: 'PENDING' | 'CHARGED' | 'FAILED';
}

// CAMARA APIs authenticate via OAuth2 client-credentials — this token
// step is standard across all Open Gateway APIs, not specific to billing.
async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !API_BASE_URL) {
    throw new Error('Dialog Carrier Billing is not configured');
  }
  const res = await fetch(`${API_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Dialog auth failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Initiates a charge against the subscriber's Dialog account. Per the
 * CAMARA spec this is typically async — the initial response confirms the
 * charge was *requested*, not that it succeeded; the actual result
 * arrives via the webhook (see the notify route). Treat the immediate
 * response as "PENDING" even if it reports otherwise, and let the
 * webhook be the source of truth for activation, same pattern as
 * PayHere's notify flow.
 */
export async function requestCharge(params: ChargeRequest): Promise<ChargeResult> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE_URL}/carrier-billing/v0.3/charges`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msisdn: params.msisdn,
      amount: { value: params.amount, currency: params.currency },
      reference: params.reference,
      description: params.description,
      // notifyUrl tells Dialog where to POST the async result — same role
      // as PayHere's notify_url.
      notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/dialog/notify`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Dialog charge request failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return { transactionId: data.transactionId, status: data.status ?? 'PENDING' };
}
