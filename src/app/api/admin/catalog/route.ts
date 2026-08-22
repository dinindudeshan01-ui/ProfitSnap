import { NextResponse } from 'next/server';
import { requireAdmin, createAdminServiceClient, logAdminAction } from '@/lib/admin/server';

// GET /api/admin/catalog — list all plans and addons (including inactive,
// since admins manage the retired ones too).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminServiceClient();
  const [plans, addons] = await Promise.all([
    db.from('plans').select('*').order('sort_order', { ascending: true }),
    db.from('addons').select('*').order('sort_order', { ascending: true }),
  ]);

  if (plans.error) return NextResponse.json({ error: plans.error.message }, { status: 500 });
  if (addons.error) return NextResponse.json({ error: addons.error.message }, { status: 500 });

  return NextResponse.json({ plans: plans.data, addons: addons.data });
}

// POST /api/admin/catalog — create a plan or addon.
// body: { kind: 'plan' | 'addon', ...fields }
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (admin.role === 'support') {
    return NextResponse.json({ error: 'Your role cannot manage the catalog' }, { status: 403 });
  }

  const body = await req.json();
  const db = createAdminServiceClient();

  if (body.kind === 'plan') {
    const { data, error } = await db
      .from('plans')
      .insert({
        name: body.name,
        description: body.description ?? null,
        price_amount: body.price_amount,
        currency: body.currency || 'LKR',
        billing_period: body.billing_period || 'monthly',
        credits_included: body.credits_included || 0,
        scan_limit_per_month: body.scan_limit_per_month ?? null,
        features: body.features ?? [],
        is_active: body.is_active ?? true,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, 'plan_created', null, { plan: data });
    return NextResponse.json({ plan: data });
  }

  if (body.kind === 'addon') {
    const { data, error } = await db
      .from('addons')
      .insert({
        name: body.name,
        description: body.description ?? null,
        price_amount: body.price_amount,
        currency: body.currency || 'LKR',
        billing_type: body.billing_type || 'one_time',
        credits_included: body.credits_included || 0,
        is_active: body.is_active ?? true,
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, 'addon_created', null, { addon: data });
    return NextResponse.json({ addon: data });
  }

  return NextResponse.json({ error: 'kind must be "plan" or "addon"' }, { status: 400 });
}
