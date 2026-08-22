-- ProfitSnap — Credit Engine schema
-- Run this AFTER schema.sql. Adds: wallet balance, an immutable transaction
-- ledger, scan_log linkage (so a refund can be system-verified instead of
-- taken on the user's word), and refund requests.
--
-- Design principle: the balance shown to the user is NEVER the source of
-- truth — it's a cached number. credit_transactions is the source of truth.
-- The balance is recomputed/reconciled from the ledger, so the UI can never
-- drift from "what actually happened," and a refund can't be invented out
-- of thin air without a corresponding ledger row pointing at a real scan.

-- ── Wallet ──────────────────────────────────────────────────────────────
-- Single row for now (dev mode, one shop, no auth) — mirrors settings'
-- single-shared-record pattern. Becomes one row per shop_id later.
create table if not exists credit_wallet (
  id int primary key default 1,
  balance int not null default 0,
  updated_at timestamptz not null default now(),
  constraint single_wallet check (id = 1)
);
insert into credit_wallet (id, balance) values (1, 0) on conflict (id) do nothing;

-- ── Transaction ledger ──────────────────────────────────────────────────
-- Every credit movement, ever. Append-only — never update or delete a row
-- here once written; corrections happen via a new offsetting transaction,
-- the same way accounting ledgers work. This is what "credits history"
-- displays, and what a refund decision is checked against.
create table if not exists credit_transactions (
  id bigint generated always as identity primary key,
  type text not null check (type in (
    'topup',           -- admin/test "add credits" action
    'scan_charge',      -- base 20-credit charge for a Gemini OCR call
    'retake_charge',    -- +5-credit charge for each retake after the first photo
    'refund_auto',       -- system-approved instant refund (scan true, inventory false)
    'refund_approved',   -- admin-approved refund after manual review
    'adjustment'         -- manual admin correction, positive or negative
  )),
  amount int not null, -- positive = credit added, negative = credit deducted
  balance_after int not null, -- snapshot, so history rows are self-contained and auditable
  scan_id uuid references scan_log (id) on delete set null,
  refund_request_id bigint, -- fk added below, after refund_requests exists
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_credittx_created on credit_transactions (created_at desc);
create index if not exists idx_credittx_scan on credit_transactions (scan_id);

-- ── Extend scan_log ───────────────────────────────────────────────────────
-- Links each scan to what it cost and whether it actually resulted in
-- committed inventory changes. `rows_committed` is the field that makes
-- "scan true, inventory false" a provable fact instead of a claim — it's
-- set only by the real save path (confirmImport), never by the user.
alter table scan_log add column if not exists retake_count int not null default 0;
alter table scan_log add column if not exists credits_charged int not null default 0;
alter table scan_log add column if not exists rows_committed boolean not null default false;
alter table scan_log add column if not exists committed_row_count int;
alter table scan_log add column if not exists user_feedback text check (user_feedback in ('correct', 'incorrect', null));
alter table scan_log add column if not exists user_comment text;

-- ── Refund requests ───────────────────────────────────────────────────────
create table if not exists refund_requests (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scan_log (id) on delete cascade,
  credits_requested int not null,
  reason text,
  status text not null default 'pending' check (status in (
    'auto_approved',  -- system verified scan_true/inventory_false, refunded instantly
    'pending',        -- needs admin review (anything not provably eligible)
    'approved',       -- admin approved after review
    'denied'          -- admin denied after review
  )),
  decided_by text, -- 'system' for auto_approved, otherwise admin identifier
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table credit_transactions
  add constraint fk_credittx_refund
  foreign key (refund_request_id) references refund_requests (id) on delete set null;

create index if not exists idx_refund_scan on refund_requests (scan_id);
create index if not exists idx_refund_status on refund_requests (status);

-- ── Grants ─────────────────────────────────────────────────────────────
-- RLS + the anon/authenticated grants for these tables are owned by
-- migration-multitenant.sql (tenant_id-scoped policies via is_admin()).
-- Do NOT disable RLS or grant anon here — if this file is ever re-run
-- after the multitenant migration, doing so silently reopens cross-tenant
-- read/write access on credit_wallet, credit_transactions, and
-- refund_requests via the anon key. New tables created by this file still
-- need sequence access to be usable pre-migration:
grant usage, select on all sequences in schema public to authenticated;
