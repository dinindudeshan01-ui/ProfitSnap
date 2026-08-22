import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';

// GET /api/admin/refunds/[refundId]/detail
// Everything needed for the refund review panel: the linked scan's photo
// (signed URL) and every scan_line_items row it actually produced — the
// real before/after values, not a guess. Without this, an admin approving
// or denying a refund is going entirely on the tenant's own description,
// which is exactly the "user can falsely accuse" problem this closes —
// the photo and the real diff are right there to check against the claim.
export async function GET(_req: Request, { params }: { params: Promise<{ refundId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { refundId } = await params;
  const db = createAdminServiceClient();

  const { data: refund, error: refundErr } = await db
    .from('refund_requests')
    .select('*, tenants(business_name), scan_log(*)')
    .eq('id', refundId)
    .maybeSingle();
  if (refundErr) return NextResponse.json({ error: refundErr.message }, { status: 500 });
  if (!refund) return NextResponse.json({ error: 'Refund request not found' }, { status: 404 });

  const scan = refund.scan_log;
  let photoUrl: string | null = null;
  if (scan?.photo_path) {
    const { data: signed } = await db.storage.from('scans').createSignedUrl(scan.photo_path, 60 * 15);
    photoUrl = signed?.signedUrl ?? null;
  }

  const { data: lineItems, error: lineErr } = scan
    ? await db.from('scan_line_items').select('*').eq('scan_id', scan.id).order('id')
    : { data: [], error: null };
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });

  return NextResponse.json({
    refund: { ...refund, business_name: refund.tenants?.business_name ?? '—' },
    scan,
    photoUrl,
    lineItems: lineItems ?? [],
  });
}
