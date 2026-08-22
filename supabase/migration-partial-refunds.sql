-- Partial refunds — admin can approve less than credits_requested, with a
-- required note explaining the calculation (e.g. "3 of 5 rows were wrong,
-- refunding 3/5 of the scan charge"). credits_requested stays exactly what
-- the tenant/system originally asked for — it's the audit trail of the
-- claim. credits_approved is nullable and only gets set at decision time,
-- so "not decided yet" (null) stays distinguishable from "approved for
-- zero" (0), which matters for reporting.

alter table refund_requests add column if not exists credits_approved int;
alter table refund_requests add column if not exists decision_note text;

alter table refund_requests
  drop constraint if exists refund_approved_amount_valid;
alter table refund_requests
  add constraint refund_approved_amount_valid check (
    credits_approved is null
    or (credits_approved >= 0 and credits_approved <= credits_requested)
  );

-- Backfill: every already-decided row gets credits_approved set to what it
-- actually paid out, inferred from the ledger. Auto-approved and
-- fully-approved rows always paid credits_requested in full (partial
-- refunds didn't exist before this migration); denied rows paid 0.
update refund_requests
set credits_approved = case
  when status in ('auto_approved', 'approved') then credits_requested
  when status = 'denied' then 0
  else null
end
where credits_approved is null and status <> 'pending';

comment on column refund_requests.credits_approved is
  'Amount actually refunded. Null = not decided yet. Can be less than credits_requested for a partial approval.';
comment on column refund_requests.decision_note is
  'Admin-entered explanation of the decision — required for partial approvals so the calculation is on record, optional otherwise.';
