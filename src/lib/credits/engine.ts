// Credit engine — server-only logic for charging, refunding, and reading
// wallet balance. This module must NEVER be imported into a client
// component. Every mutation runs through here so there is exactly one
// code path that can move credits — that's what makes "no one can cheat"
// actually true instead of aspirational. The browser only ever calls the
// API routes that wrap these functions; it never talks to credit_wallet
// or credit_transactions directly (no anon-key grants are even exercised
// for this from client code — see CREDIT_SYSTEM.md for the trust model).
//
// Post-multitenant-migration: credit_wallet has one row per tenant, keyed
// on tenant_id (the old single hardcoded id=1 row and its `id` column are
// gone — see supabase/migration-multitenant.sql). Every function here
// therefore requires a tenantId and scopes every read/write to it. This is
// what keeps one shop's balance and ledger isolated from every other shop's.

import { SupabaseClient } from '@supabase/supabase-js';

// Pricing revision (Aug 2026): Rs 10 = 20 credits -> 1 credit = Rs 0.50.
export const CREDITS_PER_RUPEE = 2; // Rs 1 = 2 credits
export const SCAN_BASE_CHARGE = 20; // 20 credits = Rs 10.00 per scan
export const RETAKE_CHARGE = 10; // 10 credits = Rs 5.00, charged per retake after the first photo

export function creditsToRupees(credits: number): number {
  return credits / CREDITS_PER_RUPEE;
}

export class InsufficientCreditsError extends Error {
  constructor(public balance: number, public required: number) {
    super(`Insufficient credits: have ${balance}, need ${required}`);
  }
}

interface ChargeResult {
  balanceAfter: number;
  transactionId: number;
}

// Deducts credits and writes a ledger row in one place. Throws
// InsufficientCreditsError if the wallet can't cover it — callers must
// check balance BEFORE doing the expensive thing (e.g. before calling
// Gemini), not after, so a broke user never burns your API cost for free.
async function charge(
  db: SupabaseClient,
  tenantId: string,
  amount: number,
  type: 'scan_charge' | 'retake_charge',
  scanId: string | null,
  note: string
): Promise<ChargeResult> {
  const { data: wallet, error: walletErr } = await db
    .from('credit_wallet')
    .select('balance')
    .eq('tenant_id', tenantId)
    .single();
  if (walletErr) throw new Error(`Failed to read wallet: ${walletErr.message}`);

  if (wallet.balance < amount) {
    throw new InsufficientCreditsError(wallet.balance, amount);
  }

  const balanceAfter = wallet.balance - amount;

  const { error: updateErr } = await db
    .from('credit_wallet')
    .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (updateErr) throw new Error(`Failed to update wallet: ${updateErr.message}`);

  const { data: tx, error: txErr } = await db
    .from('credit_transactions')
    .insert({
      tenant_id: tenantId,
      type,
      amount: -amount,
      balance_after: balanceAfter,
      scan_id: scanId,
      note,
    })
    .select('id')
    .single();
  if (txErr) throw new Error(`Failed to log transaction: ${txErr.message}`);

  return { balanceAfter, transactionId: tx.id };
}

export async function getBalance(db: SupabaseClient, tenantId: string): Promise<number> {
  const { data, error } = await db
    .from('credit_wallet')
    .select('balance')
    .eq('tenant_id', tenantId)
    .single();
  if (error) throw new Error(`Failed to read balance: ${error.message}`);
  return data.balance;
}

// Called right before the Gemini API call. This is the ONLY entry point
// that should ever deduct SCAN_BASE_CHARGE — keeping it singular makes it
// easy to audit that a scan is never charged twice for its base cost.
export async function chargeScanBase(
  db: SupabaseClient,
  tenantId: string,
  scanId: string
): Promise<ChargeResult> {
  return charge(db, tenantId, SCAN_BASE_CHARGE, 'scan_charge', scanId, 'Base OCR scan charge');
}

// Called when the user discards a photo and shoots a new one AFTER it was
// already sent to OCR at least once. The first photo of a session is never
// a retake — only redo's of an already-charged attempt are billable here.
export async function chargeRetake(
  db: SupabaseClient,
  tenantId: string,
  scanId: string
): Promise<ChargeResult> {
  return charge(db, tenantId, RETAKE_CHARGE, 'retake_charge', scanId, 'Retake charge');
}

export async function addTopup(
  db: SupabaseClient,
  tenantId: string,
  amount: number,
  note: string
): Promise<ChargeResult> {
  if (amount <= 0) throw new Error('Top-up amount must be positive');

  const { data: wallet, error: walletErr } = await db
    .from('credit_wallet')
    .select('balance')
    .eq('tenant_id', tenantId)
    .single();
  if (walletErr) throw new Error(`Failed to read wallet: ${walletErr.message}`);

  const balanceAfter = wallet.balance + amount;

  const { error: updateErr } = await db
    .from('credit_wallet')
    .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (updateErr) throw new Error(`Failed to update wallet: ${updateErr.message}`);

  const { data: tx, error: txErr } = await db
    .from('credit_transactions')
    .insert({ tenant_id: tenantId, type: 'topup', amount, balance_after: balanceAfter, note })
    .select('id')
    .single();
  if (txErr) throw new Error(`Failed to log transaction: ${txErr.message}`);

  return { balanceAfter, transactionId: tx.id };
}

interface RefundEligibility {
  eligible: boolean;
  autoApprovable: boolean;
  reason: string;
}

// The core anti-cheat check. A refund can only be auto-approved when the
// system itself can prove "credits were charged AND inventory was never
// updated" — both facts come from columns that only the server-side scan
// route and the real save path can write (rows_committed, credits_charged).
// The user's own claim ("it didn't work") is never sufficient on its own;
// it only routes to admin review when the provable condition isn't met.
export async function checkRefundEligibility(
  db: SupabaseClient,
  tenantId: string,
  scanId: string
): Promise<RefundEligibility> {
  const { data: scan, error } = await db
    .from('scan_log')
    .select('credits_charged, rows_committed, outcome')
    .eq('id', scanId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !scan) {
    return { eligible: false, autoApprovable: false, reason: 'Scan not found' };
  }
  if (scan.credits_charged <= 0) {
    return { eligible: false, autoApprovable: false, reason: 'No credits were charged for this scan' };
  }

  // Already-checked-for-refund guard happens at the request layer (unique
  // scan_id per non-denied refund_requests row) — this function only
  // answers the eligibility question for a fresh request.

  if (scan.rows_committed === false) {
    // Provable: charged, but inventory was never touched. This is exactly
    // the "scan true, inventory false" case — instant refund, no admin
    // needed, because the system (not the user) is asserting it.
    return {
      eligible: true,
      autoApprovable: true,
      reason: 'Credits were charged but no inventory rows were saved from this scan',
    };
  }

  // Inventory WAS updated from this scan. The user might still be right
  // that the data is wrong (e.g. OCR misread a quantity) — but that's a
  // judgment call about data quality, not a provable non-delivery. Goes
  // to admin.
  return {
    eligible: true,
    autoApprovable: false,
    reason: 'Inventory was updated from this scan — needs manual review',
  };
}

// Issues a refund transaction + wallet credit. Used by both the auto-path
// and the admin-approval path — same function, different `type`/`decidedBy`
// so the ledger always shows which one happened.
export async function issueRefund(
  db: SupabaseClient,
  tenantId: string,
  params: { scanId: string; amount: number; refundRequestId: number; auto: boolean; decidedBy: string }
): Promise<ChargeResult> {
  const { data: wallet, error: walletErr } = await db
    .from('credit_wallet')
    .select('balance')
    .eq('tenant_id', tenantId)
    .single();
  if (walletErr) throw new Error(`Failed to read wallet: ${walletErr.message}`);

  const balanceAfter = wallet.balance + params.amount;

  const { error: updateErr } = await db
    .from('credit_wallet')
    .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (updateErr) throw new Error(`Failed to update wallet: ${updateErr.message}`);

  const { data: tx, error: txErr } = await db
    .from('credit_transactions')
    .insert({
      tenant_id: tenantId,
      type: params.auto ? 'refund_auto' : 'refund_approved',
      amount: params.amount,
      balance_after: balanceAfter,
      scan_id: params.scanId,
      refund_request_id: params.refundRequestId,
      note: params.auto ? 'Auto-approved: charged but no inventory change' : `Approved by ${params.decidedBy}`,
    })
    .select('id')
    .single();
  if (txErr) throw new Error(`Failed to log refund transaction: ${txErr.message}`);

  return { balanceAfter, transactionId: tx.id };
}

interface OpenRefundResult {
  status: 'auto_approved' | 'pending';
  creditsRefunded?: number;
  reason?: string;
  alreadyRequested?: boolean;
}

// Shared entry point for opening a refund request against a scan, used by
// every path that can trigger one: the post-save "Something looked wrong"
// feedback prompt, the pre-save "Report an issue" flow, and the manual
// request from Credits history. Keeping this in one place means the
// duplicate-request guard and the auto-approve check can't drift between
// call sites.
export async function openRefundRequest(
  db: SupabaseClient,
  tenantId: string,
  scanId: string,
  reason: string | undefined,
  allowAutoApprove: boolean = true
): Promise<OpenRefundResult> {
  const { data: existing } = await db
    .from('refund_requests')
    .select('id, status')
    .eq('scan_id', scanId)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'auto_approved', 'approved'])
    .maybeSingle();
  if (existing) {
    return { status: existing.status as 'auto_approved' | 'pending', alreadyRequested: true };
  }

  const { data: scan } = await db
    .from('scan_log')
    .select('credits_charged')
    .eq('id', scanId)
    .eq('tenant_id', tenantId)
    .single();
  const creditsRequested = scan?.credits_charged ?? 0;

  const { data: request, error: insertErr } = await db
    .from('refund_requests')
    .insert({ tenant_id: tenantId, scan_id: scanId, credits_requested: creditsRequested, reason: reason?.trim() || null })
    .select('id')
    .single();
  if (insertErr) {
    // 23505 = unique_violation. The SELECT-then-INSERT guard above has a
    // real race window (see migration-refund-race-fix.sql) — this is the
    // database physically stopping the second insert. Treat it exactly
    // like the guard above finding an existing row, not as a failure: the
    // request is genuinely open, just created by whichever call won the
    // race, not this one.
    if (insertErr.code === '23505') {
      const { data: raceWinner } = await db
        .from('refund_requests')
        .select('id, status')
        .eq('scan_id', scanId)
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'auto_approved', 'approved'])
        .maybeSingle();
      if (raceWinner) {
        return { status: raceWinner.status as 'auto_approved' | 'pending', alreadyRequested: true };
      }
    }
    throw new Error('Could not create refund request');
  }
  if (!request) {
    throw new Error('Could not create refund request');
  }

  const eligibility = await checkRefundEligibility(db, tenantId, scanId);

  if (allowAutoApprove && eligibility.autoApprovable && creditsRequested > 0) {
    await issueRefund(db, tenantId, {
      scanId,
      amount: creditsRequested,
      refundRequestId: request.id,
      auto: true,
      decidedBy: 'system',
    });
    await db
      .from('refund_requests')
      .update({ status: 'auto_approved', decided_by: 'system', decided_at: new Date().toISOString() })
      .eq('id', request.id);
    // Same reasoning as the admin approve/deny path in
    // api/admin/refunds/route.ts: a decided refund (even an automatic
    // one) is the final word on this scan — nothing is left pending, so
    // it shouldn't keep showing as an unresolved escalation on the
    // dashboard/Escalations queue forever. Without this, an
    // auto-approved refund resolved the money but never cleared the
    // scan's own resolved flag, so its district stayed red indefinitely
    // even with nothing left to actually do.
    await db
      .from('scan_log')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'system (auto-approved refund)' })
      .eq('id', scanId)
      .eq('resolved', false);
    return { status: 'auto_approved', creditsRefunded: creditsRequested, reason: eligibility.reason };
  }

  return { status: 'pending', reason: eligibility.reason };
}
