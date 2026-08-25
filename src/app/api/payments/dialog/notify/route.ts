import { NextResponse } from 'next/server';

// POST /api/payments/dialog/notify
//
// ⚠️ SCAFFOLD — deliberately does NOT activate anything yet.
//
// This is where Dialog would POST the async result of a charge request
// (see requestCharge() in dialogCarrierBilling.ts). Unlike the PayHere
// notify route, this one can't safely verify the payload yet, because
// Dialog's actual webhook signature scheme isn't in any public spec I
// have access to — it's typically documented in the merchant portal you
// get access to after registration, and varies by implementation (some
// Open Gateway operators sign with HMAC over a shared secret, some use
// mutual TLS, some just trust the source IP).
//
// DO NOT wire this up to actually grant credits/activate a subscription
// until you have Dialog's real webhook spec and have implemented proper
// signature verification here — an unverified webhook that grants
// credits is a direct "free credits" exploit. Follow the exact same
// pattern as verifyNotifySignature() in payhere.ts once you have the
// real spec: reject anything that doesn't verify, only then look up and
// update the matching tenant_subscriptions/tenant_addon_purchases row by
// provider_ref.
export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);

  console.warn(
    '[Dialog Carrier Billing notify] Received a webhook but signature verification is not implemented yet — ignoring. Payload:',
    payload
  );

  // Respond 200 so Dialog doesn't treat this as a delivery failure and
  // retry indefinitely, but do NOT process the payload until real
  // verification is implemented.
  return NextResponse.json({ ok: true, note: 'Received but not processed — signature verification pending' });
}
