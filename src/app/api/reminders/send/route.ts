// POST /api/reminders/send
// Body: { customerId: number, creditSaleId?: number, message: string }
//
// Merchant taps "Send reminder" -> this route checks the plan gate + this
// period's quota, then dispatches an SMS to the customer. Free-tier
// tenants (no active paid plan) always get ReminderNotAllowedError here —
// there is no addon workaround, by design (see migration-credit-sales-
// reminders.sql).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, getRequestTenantId } from '@/lib/supabase/server';
import {
  sendReminder,
  getReminderQuota,
  ReminderNotAllowedError,
  ReminderQuotaExceededError,
} from '@/lib/reminders/engine';

export async function POST(req: NextRequest) {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.customerId !== 'number' || typeof body.message !== 'string') {
    return NextResponse.json({ ok: false, error: 'customerId and message are required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    const result = await sendReminder(supabase, {
      tenantId,
      customerId: body.customerId,
      creditSaleId: typeof body.creditSaleId === 'number' ? body.creditSaleId : undefined,
      message: body.message,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReminderNotAllowedError) {
      return NextResponse.json({ ok: false, error: err.message, upgrade: true }, { status: 402 });
    }
    if (err instanceof ReminderQuotaExceededError) {
      return NextResponse.json(
        { ok: false, error: `Reminder limit reached (${err.used}/${err.limit} used this month).`, upgrade: true },
        { status: 429 }
      );
    }
    console.error('Reminder send failed:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to send reminder' },
      { status: 500 }
    );
  }
}

// GET /api/reminders/send — quota check, used by the UI to show "12/15
// reminders left this month" and to grey out the button before the user
// even tries.
export async function GET() {
  const tenantId = await getRequestTenantId();
  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createServiceClient();
  const quota = await getReminderQuota(supabase, tenantId);
  return NextResponse.json({ ok: true, ...quota, remaining: Math.max(0, quota.reminderLimit - quota.used) });
}
