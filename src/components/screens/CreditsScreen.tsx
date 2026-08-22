'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ChevronDown, ChevronUp, Camera, RotateCcw, Gift, Undo2, SlidersHorizontal } from 'lucide-react';
import { useLang } from '@/lib/i18n/LangContext';
import { useToast } from '@/components/Toast';
import ArcHeader from '@/components/ArcHeader';
import DataLoadError from '@/components/DataLoadError';
import BottomSheet from '@/components/BottomSheet';
import PressableButton from '@/components/PressableButton';
import DuplicateHoldNotice from '@/components/DuplicateHoldNotice';
import { colors } from '@/lib/theme';
import { CreditTransaction, creditsToRupeesDisplay, SCAN_BASE_CHARGE, RETAKE_CHARGE, CREDITS_PER_RUPEE } from '@/lib/credits/format';

const TYPE_META: Record<string, { label: string; Icon: React.ComponentType<{ size?: number; color?: string }>; color: string }> = {
  scan_charge: { label: 'Scan charge', Icon: Camera, color: colors.stock },
  retake_charge: { label: 'Retake charge', Icon: RotateCcw, color: colors.sales },
  topup: { label: 'Credits added', Icon: Plus, color: colors.products },
  refund_auto: { label: 'Refund (instant)', Icon: Undo2, color: colors.products },
  refund_approved: { label: 'Refund (approved)', Icon: Undo2, color: colors.products },
  adjustment: { label: 'Adjustment', Icon: SlidersHorizontal, color: colors.sub },
};

const TOPUP_PRESETS = [50, 100, 250, 500];

export default function CreditsScreen() {
  const router = useRouter();
  const { t } = useLang();
  const showToast = useToast();

  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  // Keyed by scan_id -> that scan's most recent refund_requests status, so
  // the "Request a refund" button can be hidden/relabeled instead of
  // staying clickable for a scan that already has one in flight or
  // decided. The backend already no-ops a duplicate request safely, but
  // the button showing "Request a refund" on an already-requested scan
  // looked broken/risky even though nothing bad actually happens.
  const [refundStatusByScan, setRefundStatusByScan] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [topupBusy, setTopupBusy] = useState<number | null>(null); // the amount currently being submitted, if any

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setError(null);
    try {
      const [balResp, histResp, refundResp] = await Promise.all([
        fetch('/api/credits/balance'),
        fetch('/api/credits/history'),
        fetch('/api/credits/refund'),
      ]);

      // A 401 here means the session isn't logged in as a tenant (e.g. no
      // session at all, or logged in as an admin account instead) — that's
      // not a data/server problem, so send the person to log in rather
      // than showing a scary generic error.
      if (balResp.status === 401 || histResp.status === 401) {
        router.push('/login');
        return;
      }

      const [balRes, histRes, refundRes] = await Promise.all([balResp.json(), histResp.json(), refundResp.json()]);
      if (!balRes.ok) throw new Error(balRes.error || 'Could not load balance');
      if (!histRes.ok) throw new Error(histRes.error || 'Could not load history');
      setBalance(balRes.balance);
      setTransactions(histRes.transactions);

      // refundRes failing isn't fatal to the whole screen — worst case the
      // refund button just doesn't know a request already exists yet.
      if (refundRes.ok) {
        // Mirrors the backend's duplicate guard in openRefundRequest /
        // POST /api/credits/refund, which only blocks a new request when
        // status is pending/auto_approved/approved — a denied request can
        // still be re-requested, so it's deliberately left out here.
        const byScan: Record<string, string> = {};
        for (const r of refundRes.refunds ?? []) {
          if (r.scan_id && ['pending', 'auto_approved', 'approved'].includes(r.status)) {
            byScan[r.scan_id] = r.status;
          }
        }
        setRefundStatusByScan(byScan);
      }
      if (opts?.silent) setError(null);
    } catch (err) {
      console.error('CreditsScreen load failed:', err);
      if (!opts?.silent) setError(err instanceof Error ? err.message : 'Could not load credits');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && !topupOpen) load({ silent: true });
    }
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, topupOpen]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !topupOpen) load({ silent: true });
    }, 15000);
    return () => clearInterval(interval);
  }, [load, topupOpen]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleTopup(amount: number) {
    setTopupBusy(amount);
    try {
      const res = await fetch('/api/credits/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Top-up failed');
      showToast(`+${amount} credits added`);
      setTopupOpen(false);
      setCustomAmount('');
      load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setTopupBusy(null);
    }
  }

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.credits} />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Credits" subtitle="Balance, scan costs, and refunds" color={colors.credits} onBack={() => router.push('/')} />

      <div className="px-4 pt-2 flex justify-end">
        <button
          onClick={() => router.push('/credits/refund/history')}
          className="text-xs font-semibold"
          style={{ color: colors.credits }}
        >
          Refund history →
        </button>
      </div>

      <div className="px-4 pt-4">
        <div className="rounded-[20px] bg-white p-5 text-center shadow-sm">
          <div className="text-[13px] font-semibold text-sub">Current balance</div>
          <div className="mt-1 text-[40px] font-extrabold tracking-tight" style={{ color: colors.credits }}>
            {loading ? '—' : balance}
          </div>
          <div className="mt-1 text-xs text-sub">
            {loading || balance === null ? '' : `≈ Rs ${creditsToRupeesDisplay(balance)}`}
          </div>
          <button
            onClick={() => setTopupOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: colors.credits }}
          >
            <Plus size={15} /> Add credits
          </button>
        </div>

        <DuplicateHoldNotice />

        <div className="mt-4 rounded-xl p-3.5" style={{ backgroundColor: colors.creditsLight }}>
          <div className="text-[12px] font-semibold" style={{ color: colors.credits }}>
            Pricing: {SCAN_BASE_CHARGE} credits per scan · +{RETAKE_CHARGE} credits per retake
          </div>
          <div className="mt-0.5 text-[11px] text-sub">
            1 credit = Rs {(1 / CREDITS_PER_RUPEE).toFixed(2)} · a scan with one retake costs {SCAN_BASE_CHARGE + RETAKE_CHARGE} credits (Rs{' '}
            {creditsToRupeesDisplay(SCAN_BASE_CHARGE + RETAKE_CHARGE)})
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 pt-5">
        <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sub">History</h2>

        {loading ? (
          <p className="py-10 text-center text-sm text-sub">Loading…</p>
        ) : transactions.length === 0 ? (
          <div className="flex items-center justify-center py-14">
            <p className="text-center text-sm text-sub">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2 pb-8">
            {transactions.map((tx) => {
              const meta = TYPE_META[tx.type] || TYPE_META.adjustment;
              const isOpen = expanded.has(tx.id);
              const isPositive = tx.amount > 0;
              return (
                <div key={tx.id} className="overflow-hidden rounded-xl bg-white shadow-sm">
                  <button
                    onClick={() => toggleExpand(tx.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                      style={{ backgroundColor: `${meta.color}18` }}
                    >
                      <meta.Icon size={16} color={meta.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-foreground">{meta.label}</div>
                      <div className="mt-0.5 text-[11px] text-sub">
                        {new Date(tx.created_at).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: isPositive ? colors.products : colors.danger }}>
                        {isPositive ? '+' : ''}
                        {tx.amount}
                      </div>
                      <div className="text-[10px] text-sub">bal {tx.balance_after}</div>
                    </div>
                    {isOpen ? <ChevronUp size={16} color={colors.sub} /> : <ChevronDown size={16} color={colors.sub} />}
                  </button>

                  {isOpen && (
                    <div className="border-t px-3.5 py-3" style={{ borderColor: colors.border }}>
                      {tx.note && <p className="mb-2 text-[12px] text-sub">{tx.note}</p>}
                      {tx.scan_log ? (
                        <div className="space-y-1.5 text-[12px]">
                          <Row label="Scan type" value={tx.scan_log.scan_type} />
                          <Row label="Outcome" value={tx.scan_log.outcome.replace('_', ' ')} />
                          <Row label="Retakes" value={String(tx.scan_log.retake_count)} />
                          <Row label="Total charged" value={`${tx.scan_log.credits_charged} credits`} />
                          <Row
                            label="Inventory updated"
                            value={tx.scan_log.rows_committed ? 'Yes' : 'No'}
                            valueColor={tx.scan_log.rows_committed ? colors.products : colors.danger}
                          />
                          {tx.scan_log.row_count !== null && <Row label="Rows found" value={String(tx.scan_log.row_count)} />}
                        </div>
                      ) : (
                        <p className="text-[12px] text-sub">No scan linked to this transaction.</p>
                      )}

                      {tx.scan_id && tx.type === 'scan_charge' && (
                        (() => {
                          const existingStatus = refundStatusByScan[tx.scan_id];
                          if (existingStatus) {
                            const label =
                              existingStatus === 'pending' ? 'Refund requested — awaiting review' : 'Refund already issued';
                            return (
                              <button
                                onClick={() => router.push('/credits/refund/history')}
                                className="mt-3 w-full rounded-lg border py-2 text-[12px] font-semibold"
                                style={{ borderColor: colors.border, color: colors.sub }}
                              >
                                {label} — view →
                              </button>
                            );
                          }
                          return (
                            <button
                              onClick={() => router.push(`/credits/refund?scanId=${tx.scan_id}`)}
                              className="mt-3 w-full rounded-lg border py-2 text-[12px] font-semibold"
                              style={{ borderColor: colors.border, color: colors.danger }}
                            >
                              Request a refund for this scan
                            </button>
                          );
                        })()
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet visible={topupOpen} onClose={() => setTopupOpen(false)}>
        <h2 className="mb-1 text-xl font-bold tracking-tight text-foreground">Add credits</h2>
        <p className="mb-4 text-[12px] text-sub">
          Testing mode — this stands in for a real payment gateway for now.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {TOPUP_PRESETS.map((amt) => (
            <PressableButton
              key={amt}
              disabled={topupBusy !== null}
              loading={topupBusy === amt}
              loadingColor={colors.credits}
              onClick={() => handleTopup(amt)}
              className="rounded-xl border-2 py-3 text-center disabled:opacity-50"
              style={{ borderColor: colors.creditsLight, backgroundColor: colors.creditsLight }}
            >
              <div className="text-base font-bold" style={{ color: colors.credits }}>
                +{amt}
              </div>
              <div className="text-[11px] text-sub">Rs {creditsToRupeesDisplay(amt)}</div>
            </PressableButton>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Custom amount"
            inputMode="numeric"
            className="flex-1 rounded-xl bg-bg px-3.5 py-3 text-[15px] text-foreground outline-none"
          />
          <PressableButton
            disabled={topupBusy !== null || !customAmount}
            loading={topupBusy !== null && topupBusy === (parseInt(customAmount, 10) || 0)}
            onClick={() => handleTopup(parseInt(customAmount, 10) || 0)}
            className="rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: colors.credits }}
          >
            Add
          </PressableButton>
        </div>
        <button onClick={() => setTopupOpen(false)} className="mt-3 w-full py-3 text-sm text-sub">
          {t.cancel}
        </button>
      </BottomSheet>
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sub">{label}</span>
      <span className="font-semibold text-foreground" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}