import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';

// GET /api/admin/customer/[tenantId]/photos
// Lists this shop's stored scan photos with a signed URL each (works
// regardless of whether the 'scans' bucket is public or private) plus a
// running total so storage usage per shop is visible without ever having
// to list the whole bucket.
export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tenantId } = await params;
  const db = createAdminServiceClient();

  const { data: scans, error } = await db
    .from('scan_log')
    .select('id, scan_type, photo_path, photo_bytes, created_at')
    .eq('tenant_id', tenantId)
    .not('photo_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = scans ?? [];
  const paths = rows.map((r) => r.photo_path as string);

  let signedUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await db.storage.from('scans').createSignedUrls(paths, 60 * 10); // 10 min, admin-viewing only
    signedUrls = Object.fromEntries(
      (signed ?? []).map((s, i) => [paths[i], s.signedUrl ?? '']).filter(([, url]) => url)
    );
  }

  const totalBytes = rows.reduce((sum, r) => sum + (r.photo_bytes ?? 0), 0);

  return NextResponse.json({
    totalBytes,
    photos: rows.map((r) => ({ ...r, url: signedUrls[r.photo_path as string] ?? null })),
  });
}

// DELETE /api/admin/customer/[tenantId]/photos
// body: { scanId: number } to remove one photo, or { all: true } to wipe
// every stored photo for this shop. Actually removes the object from
// Supabase Storage — clearing photo_path/photo_bytes alone would just
// hide the reference and leave the file (and the storage cost) behind.
export async function DELETE(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot delete stored photos' }, { status: 403 });
  }

  const { tenantId } = await params;
  const body = await req.json().catch(() => ({}));
  const db = createAdminServiceClient();

  let query = db.from('scan_log').select('id, photo_path').eq('tenant_id', tenantId).not('photo_path', 'is', null);
  if (!body.all) {
    const scanId = Number(body.scanId);
    if (!Number.isFinite(scanId)) return NextResponse.json({ error: 'scanId or all is required' }, { status: 400 });
    query = query.eq('id', scanId);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, deleted: 0 });

  const paths = rows.map((r) => r.photo_path as string);
  const { error: removeErr } = await db.storage.from('scans').remove(paths);
  // Storage removal failing shouldn't block clearing the DB reference —
  // an orphaned object costs a few KB, a stuck "can't reset" UI costs more.
  if (removeErr) console.error('Storage remove failed:', removeErr.message);

  await db
    .from('scan_log')
    .update({ photo_path: null, photo_bytes: null })
    .in('id', rows.map((r) => r.id));

  await logAdminAction(admin, body.all ? 'shop_photos_reset' : 'shop_photo_deleted', tenantId, {
    count: rows.length,
  });

  return NextResponse.json({ ok: true, deleted: rows.length });
}
