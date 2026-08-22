import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient } from '@/lib/admin/server';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminServiceClient();

  const [{ data: statusRows }, { count: pendingFlags }, { count: pendingRefunds }, storageAgg] = await Promise.all([
    db.from('tenants').select('status'),
    db.from('tenant_duplicate_flags').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('refund_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('scan_log').select('photo_bytes').not('photo_path', 'is', null),
  ]);

  const totalStorageBytes = (storageAgg.data ?? []).reduce((sum, r) => sum + (r.photo_bytes ?? 0), 0);

  const counts = { active: 0, trial: 0, suspended: 0 };
  for (const row of statusRows ?? []) {
    if (row.status in counts) counts[row.status as keyof typeof counts]++;
  }

  return NextResponse.json({
    total: statusRows?.length ?? 0,
    active: counts.active,
    trial: counts.trial,
    suspended: counts.suspended,
    pendingFlags: pendingFlags ?? 0,
    pendingRefunds: pendingRefunds ?? 0,
    totalStorageBytes,
  });
}
