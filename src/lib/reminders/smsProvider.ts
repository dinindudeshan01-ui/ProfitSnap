// SMS provider — single swap point for whichever Sri Lankan SMS gateway
// account you set up (Dialog SMS Gateway, Hutch, or an aggregator like
// notify.lk / text.lk). Nothing else in the codebase should import a
// provider SDK directly — everything goes through sendSms() so switching
// providers later is a one-file change.
//
// TODO before going live: pick a provider, get an account + API key, set
// SMS_PROVIDER_API_KEY / SMS_PROVIDER_SENDER_ID in .env.local, and replace
// the fetch call below with that provider's actual send endpoint. Until
// then this logs to the console and returns a fake success so the rest of
// the reminders flow (quota checks, ledger writes) can be built and tested
// without a live SMS account.

interface SmsResult {
  providerRef: string;
}

const SMS_API_KEY = process.env.SMS_PROVIDER_API_KEY;
const SMS_SENDER_ID = process.env.SMS_PROVIDER_SENDER_ID || 'ProfitSnap';

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  if (!SMS_API_KEY) {
    // No provider configured yet — dev-mode stub. Logs so you can verify
    // the reminder flow end-to-end before wiring a real gateway.
    console.warn(
      `[sendSms:STUB] No SMS_PROVIDER_API_KEY set — would send to ${phone}: "${message}"`
    );
    return { providerRef: `stub_${Date.now()}` };
  }

  // Example shape for notify.lk-style gateways — replace with your chosen
  // provider's actual request format once you have an account.
  const res = await fetch('https://app.notify.lk/api/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: process.env.SMS_PROVIDER_USER_ID,
      api_key: SMS_API_KEY,
      sender_id: SMS_SENDER_ID,
      to: phone,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SMS provider error (${res.status}): ${body}`);
  }

  const data = await res.json().catch(() => ({}));
  return { providerRef: data.message_id || data.id || `unknown_${Date.now()}` };
}
