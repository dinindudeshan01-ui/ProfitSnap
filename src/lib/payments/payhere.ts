// PayHere (payhere.lk) — Sri Lanka's card gateway (Visa/Mastercard/Amex).
// Docs: https://support.payhere.lk/api-&-mobile-sdk/checkout-api
//
// Setup needed before this works (do this in your PayHere merchant
// dashboard, not in code):
//   1. Sign up / log in at https://www.payhere.lk (business account)
//   2. Get your Merchant ID and Merchant Secret from
//      Settings → Domains & Credentials
//   3. Add this app's domain under "Approved Domains" — both your Vercel
//      domain AND api.weersme.com.lk if you use that for the notify URL
//   4. Set env vars: PAYHERE_MERCHANT_ID, PAYHERE_MERCHANT_SECRET
//   5. For testing, use the sandbox merchant id/secret from a PayHere
//      sandbox account and set PAYHERE_SANDBOX=true — flip to false (or
//      unset) once you have production credentials approved.
//
// Until PAYHERE_MERCHANT_ID/SECRET are set, isPayHereConfigured() returns
// false and the billing route falls back to the existing manual
// admin-confirmation flow — same graceful-degradation pattern as
// smsProvider.ts.

import crypto from 'crypto';

const MERCHANT_ID = process.env.PAYHERE_MERCHANT_ID;
const MERCHANT_SECRET = process.env.PAYHERE_MERCHANT_SECRET;
const IS_SANDBOX = process.env.PAYHERE_SANDBOX === 'true';

export function isPayHereConfigured(): boolean {
  return Boolean(MERCHANT_ID && MERCHANT_SECRET);
}

export const PAYHERE_CHECKOUT_URL = IS_SANDBOX
  ? 'https://sandbox.payhere.lk/pay/checkout'
  : 'https://www.payhere.lk/pay/checkout';

interface CheckoutParams {
  orderId: string; // must be unique per attempt — we use `sub_<subscriptionRowId>` / `addon_<purchaseRowId>`
  amount: number;
  currency?: string; // PayHere requires LKR or USD; default LKR
  itemName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  customerFirstName: string;
  customerEmail: string;
  customerPhone?: string;
}

/**
 * PayHere's checkout hash: md5( merchant_id + order_id + amount + currency
 * + md5(merchant_secret) ), uppercased. Amount must be formatted with
 * exactly 2 decimal places or the hash won't match what PayHere computes
 * on their end, and the request gets silently rejected.
 */
function computeHash(orderId: string, amount: number, currency: string): string {
  if (!MERCHANT_ID || !MERCHANT_SECRET) {
    throw new Error('PayHere is not configured (PAYHERE_MERCHANT_ID/SECRET missing)');
  }
  const amountFormatted = amount.toFixed(2);
  const secretHash = crypto.createHash('md5').update(MERCHANT_SECRET).digest('hex').toUpperCase();
  const raw = `${MERCHANT_ID}${orderId}${amountFormatted}${currency}${secretHash}`;
  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
}

/** Builds the exact field set the PayHere checkout form/JS SDK needs.
 * The frontend either POSTs these as a hidden form to PAYHERE_CHECKOUT_URL,
 * or passes them to payhere.startPayment() if using their JS SDK. */
export function buildCheckoutParams(params: CheckoutParams) {
  const currency = params.currency ?? 'LKR';
  const hash = computeHash(params.orderId, params.amount, currency);

  return {
    merchant_id: MERCHANT_ID,
    return_url: params.returnUrl,
    cancel_url: params.cancelUrl,
    notify_url: params.notifyUrl,
    order_id: params.orderId,
    items: params.itemName,
    amount: params.amount.toFixed(2),
    currency,
    first_name: params.customerFirstName || 'Customer',
    last_name: '',
    email: params.customerEmail,
    phone: params.customerPhone || '',
    address: '',
    city: '',
    country: 'Sri Lanka',
    hash,
  };
}

/**
 * Verifies an incoming PayHere notify-webhook payload. PayHere computes
 * its own md5sig the same way (but with status_code folded in) and this
 * MUST match or the webhook could be forged — never trust a notify
 * callback without checking this.
 */
export function verifyNotifySignature(payload: {
  merchant_id: string;
  order_id: string;
  amount: string;
  payhere_amount: string;
  payhere_currency: string;
  status_code: string;
  md5sig: string;
}): boolean {
  if (!MERCHANT_SECRET) return false;
  const secretHash = crypto.createHash('md5').update(MERCHANT_SECRET).digest('hex').toUpperCase();
  const raw =
    payload.merchant_id +
    payload.order_id +
    payload.payhere_amount +
    payload.payhere_currency +
    payload.status_code +
    secretHash;
  const expected = crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
  return expected === payload.md5sig;
}

// PayHere status_code values: 2 = success, 0 = pending, -1 = cancelled,
// -2 = failed, -3 = chargedback.
export const PAYHERE_STATUS = {
  SUCCESS: '2',
  PENDING: '0',
  CANCELLED: '-1',
  FAILED: '-2',
  CHARGEDBACK: '-3',
} as const;
