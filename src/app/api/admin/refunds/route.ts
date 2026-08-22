import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';
import { issueRefund } from '@/lib/credits/engine';
import { sendPushNotification } from '@/lib/native/pushSender';

// GET /api/admin/refunds
// Cross-tenant queue of refund requests that need a human decision. Only
// 'pending' status shows here by default — 'auto_approved' ones never
// needed a person, and 'approved'/'denied' are already resolved. This is
// the screen that was missing: refund_requests existed in the schema and
// were written by /api/scan/feedback and /api/credits/refund, but nothing
// admin-facing ever listed them across tenants — an admin had to already
// know which tenant to open before seeing one.
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') || 'pending';

  const db = createAdminServiceClient();
  let query = db
    .from('refund_requests')
    .select(
      `id, scan_id, credits_requested, credits_approved, decision_note, reason, status, decided_by, decided_at, created_at, tenant_id,
       tenants(business_name),
       scan_log(scan_type, outcome, rows_committed, committed_row_count, credits_charged, user_comment, photo_path)`
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Sign the scan photo for every row that has one — the whole point of
  // a refund review is judging whether the scan actually looks wrong;
  // without the photo an admin is deciding blind, from a text summary
  // alone.
  const paths = rows.map((r: any) => r.scan_log?.photo_path).filter((p: unknown): p is string => !!p);
  let signedUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await db.storage.from('scans').createSignedUrls(paths, 60 * 15); // 15 min
    signedUrls = Object.fromEntries(
      (signed ?? []).map((s, i) => [paths[i], s.signedUrl ?? '']).filter(([, url]) => url)
    );
  }

  const enriched = rows.map((r: any) => ({
    ...r,
    business_name: r.tenants?.business_name ?? '—',
    scan: r.scan_log ?? null,
    photo_url: r.scan_log?.photo_path ? signedUrls[r.scan_log.photo_path] ?? null : null,
  }));

  return NextResponse.json({ refunds: enriched });
}

// POST /api/admin/refunds
// body: { refundRequestId: number, decision: 'approve' | 'deny', amount?: number, note?: string }
// Finance-only, same as manual credit adjustments — approving a refund
// moves money, same as adjust_credits does on the customer detail screen.
//
// `amount` is optional and defaults to the full credits_requested — pass a
// smaller number for a partial refund (e.g. only 3 of 5 misread rows were
// actually wrong). `note` is required whenever amount < credits_requested,
// so the calculation behind a partial decision is always on record, not
// just implied by the number.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot decide refunds' }, { status: 403 });
  }

  const body = await req.json();
  const refundRequestId = Number(body.refundRequestId);
  const decision = body.decision;
  const note: string | null = typeof body.note === 'string' ? body.note.trim() || null : null;
  if (!Number.isFinite(refundRequestId) || (decision !== 'approve' && decision !== 'deny')) {
    return NextResponse.json({ error: 'refundRequestId and a valid decision are required' }, { status: 400 });
  }

  const db = createAdminServiceClient();

  const { data: request, error: fetchErr } = await db
    .from('refund_requests')
    .select('id, tenant_id, scan_id, credits_requested, status')
    .eq('id', refundRequestId)
    .single();
  if (fetchErr || !request) {
    return NextResponse.json({ error: 'Refund request not found' }, { status: 404 });
  }
  if (request.status !== 'pending') {
    return NextResponse.json({ error: `Already decided (${request.status})` }, { status: 400 });
  }

  if (decision === 'deny') {
    const { error } = await db
      .from('refund_requests')
      .update({
        status: 'denied',
        credits_approved: 0,
        decision_note: note,
        decided_by: admin.email,
        decided_at: new Date().toISOString(),
      })
      .eq('id', refundRequestId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await resolveLinkedScan(db, request.scan_id, admin.email);
    await logAdminAction(admin, 'refund_denied', request.tenant_id, { refundRequestId, scanId: request.scan_id, note });
    // Best-effort — never lets a push failure affect the actual decision
    // that was just made and saved above.
    sendPushNotification(db, request.tenant_id, {
      title: 'Refund request update',
      body: 'Your refund request was reviewed — tap to see the details.',
      data: { type: 'refund_decided', refundRequestId: String(refundRequestId) },
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: 'denied' });
  }

  // decision === 'approve' — resolve the amount, defaulting to the full
  // requested amount when the admin didn't specify one.
  const rawAmount = body.amount;
  const amount = rawAmount === undefined || rawAmount === null ? request.credits_requested : Number(rawAmount);

  if (!Number.isFinite(amount) || amount < 0 || amount > request.credits_requested) {
    return NextResponse.json(
      { error: `amount must be between 0 and the requested ${request.credits_requested}` },
      { status: 400 }
    );
  }
  const isPartial = amount < request.credits_requested;
  if (isPartial && !note) {
    return NextResponse.json({ error: 'A note explaining the calculation is required for a partial refund' }, { status: 400 });
  }

  let result = { balanceAfter: null as number | null };
  if (amount > 0) {
    result = await issueRefund(db, request.tenant_id, {
      scanId: request.scan_id,
      amount,
      refundRequestId,
      auto: false,
      decidedBy: admin.email,
    });
  }

  const { error: updateErr } = await db
    .from('refund_requests')
    .update({
      status: 'approved',
      credits_approved: amount,
      decision_note: note,
      decided_by: admin.email,
      decided_at: new Date().toISOString(),
    })
    .eq('id', refundRequestId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await resolveLinkedScan(db, request.scan_id, admin.email);

  await logAdminAction(admin, isPartial ? 'refund_partially_approved' : 'refund_approved', request.tenant_id, {
    refundRequestId,
    scanId: request.scan_id,
    requestedAmount: request.credits_requested,
    approvedAmount: amount,
    note,
    newBalance: result.balanceAfter,
  });

  sendPushNotification(db, request.tenant_id, {
    title: 'Refund approved',
    body: `${amount} credits were added to your account.`,
    data: { type: 'refund_decided', refundRequestId: String(refundRequestId) },
  }).catch(() => {});

  return NextResponse.json({ ok: true, status: 'approved', amount, newBalance: result.balanceAfter });
}

// A refund decision (approve OR deny) is the admin's final word on this
// scan — there's nothing left "pending" once money has been decided one
// way or the other. Without this, deciding a refund and marking its
// linked escalation resolved were two totally separate admin actions
// that never talked to each other: a tenant's shop could show every
// refund approved/denied and still render red on the dashboard map
// forever, because scan_log.resolved only ever got set by the separate
// "Mark resolved" button on the Escalations page. This auto-resolves the
// scan the refund is linked to, if one exists and isn't already resolved
// — it's a no-op for refund requests with no linked scan or an already-
// resolved one, so it's safe to call unconditionally on every decision.
async function resolveLinkedScan(
  db: ReturnType<typeof createAdminServiceClient>,
  scanId: string | null,
  adminEmail: string
) {
  if (!scanId) return;
  await db
    .from('scan_log')
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: adminEmail })
    .eq('id', scanId)
    .eq('resolved', false);
}
