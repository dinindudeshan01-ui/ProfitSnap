// Reminders engine — server-only. Reminders are a PLAN feature, not a
// credit-purchasable one: Free-tier tenants have reminder_limit_per_month
// = 0 on their plan row and can never send one, no matter how many credits
// they have. This file is the only place that checks that gate and writes
// a reminders row, mirroring how src/lib/credits/engine.ts is the only
// place allowed to move credits.

import { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from './smsProvider';

export class ReminderNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderNotAllowedError';
  }
}

export class ReminderQuotaExceededError extends Error {
  constructor(public used: number, public limit: number) {
    super(`Reminder quota exceeded: ${used}/${limit} used this period`);
  }
}

interface PlanReminderInfo {
  reminderLimit: number;
  used: number;
}

// Reads the tenant's active plan + how many reminders it has sent this
// billing period, via the tenant_reminder_usage view (see
// migration-credit-sales-reminders.sql) so quota can never drift out of
// sync with the actual reminders table.
export async function getReminderQuota(
  db: SupabaseClient,
  tenantId: string
): Promise<PlanReminderInfo> {
  const { data: sub, error: subErr } = await db
    .from('tenant_subscriptions')
    .select('plan_id, plans(reminder_limit_per_month)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .single();

  if (subErr || !sub) {
    // No active subscription at all -> Free tier -> zero reminder capability.
    return { reminderLimit: 0, used: 0 };
  }

  const plan = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans;
  const reminderLimit = plan?.reminder_limit_per_month ?? 0;

  const { data: usage } = await db
    .from('tenant_reminder_usage')
    .select('reminders_used_this_period')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return { reminderLimit, used: usage?.reminders_used_this_period ?? 0 };
}

interface SendReminderInput {
  tenantId: string;
  customerId: number;
  creditSaleId?: number;
  message: string;
}

interface SendReminderResult {
  reminderId: number;
  status: 'sent' | 'failed';
}

// Called when the merchant taps "Send reminder" on a customer/credit-sale.
// 1. Check the plan allows reminders at all (limit > 0)
// 2. Check this period's usage hasn't hit the limit
// 3. Look up the customer's phone number
// 4. Dispatch via the SMS provider, log the outcome either way
export async function sendReminder(
  db: SupabaseClient,
  input: SendReminderInput
): Promise<SendReminderResult> {
  const { reminderLimit, used } = await getReminderQuota(db, input.tenantId);

  if (reminderLimit <= 0) {
    throw new ReminderNotAllowedError(
      'Reminders are a paid-plan feature — upgrade to Small Business (Rs 299) or Small + Business (Rs 499) to send reminders.'
    );
  }
  if (used >= reminderLimit) {
    throw new ReminderQuotaExceededError(used, reminderLimit);
  }

  const { data: customer, error: custErr } = await db
    .from('customers')
    .select('id, name, phone')
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)
    .single();
  if (custErr || !customer) {
    throw new Error('Customer not found');
  }
  if (!customer.phone) {
    throw new Error(`${customer.name} has no phone number on file — add one before sending a reminder.`);
  }

  const { data: row, error: insertErr } = await db
    .from('reminders')
    .insert({
      tenant_id: input.tenantId,
      customer_id: input.customerId,
      credit_sale_id: input.creditSaleId ?? null,
      channel: 'sms',
      message: input.message,
      status: 'queued',
    })
    .select('id')
    .single();
  if (insertErr || !row) throw new Error(`Failed to log reminder: ${insertErr?.message}`);

  try {
    const result = await sendSms(customer.phone, input.message);
    await db
      .from('reminders')
      .update({ status: 'sent', provider_ref: result.providerRef, sent_at: new Date().toISOString() })
      .eq('id', row.id);
    return { reminderId: row.id, status: 'sent' };
  } catch (err) {
    await db
      .from('reminders')
      .update({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' })
      .eq('id', row.id);
    return { reminderId: row.id, status: 'failed' };
  }
}
