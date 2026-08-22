import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';

// PATCH /api/admin/catalog/[kind]/[id]  — kind is 'plans' or 'addons'
// DELETE same path — we soft-delete via is_active=false rather than a hard
// delete when a plan/addon has ever been purchased, so tenant history and
// the ledger keep working; hard delete only when never used.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot manage the catalog' }, { status: 403 });
  }

  const { kind, id } = await params;
  if (kind !== 'plans' && kind !== 'addons') {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }

  const body = await req.json();
  const db = createAdminServiceClient();
  const { data, error } = await db
    .from(kind)
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAdminAction(admin, `${kind.slice(0, -1)}_updated`, null, { id, changes: body });
  return NextResponse.json({ [kind.slice(0, -1)]: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot manage the catalog' }, { status: 403 });
  }

  const { kind, id } = await params;
  if (kind !== 'plans' && kind !== 'addons') {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }

  const db = createAdminServiceClient();
  const usageTable = kind === 'plans' ? 'tenant_subscriptions' : 'tenant_addon_purchases';
  const usageColumn = kind === 'plans' ? 'plan_id' : 'addon_id';

  const { count } = await db
    .from(usageTable)
    .select('id', { count: 'exact', head: true })
    .eq(usageColumn, id);

  if (count && count > 0) {
    // In use somewhere — retire instead of deleting so we never orphan a
    // tenant's subscription/purchase row.
    const { error } = await db.from(kind).update({ is_active: false }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, `${kind.slice(0, -1)}_retired`, null, { id });
    return NextResponse.json({ ok: true, retired: true });
  }

  const { error } = await db.from(kind).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAdminAction(admin, `${kind.slice(0, -1)}_deleted`, null, { id });
  return NextResponse.json({ ok: true, retired: false });
}
