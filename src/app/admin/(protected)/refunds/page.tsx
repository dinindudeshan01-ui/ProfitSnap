'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface RefundRow {
  id: number;
  scan_id: string;
  credits_requested: number;
  credits_approved: number | null;
  decision_note: string | null;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  tenant_id: string;
  business_name: string;
  scan: {
    scan_type: string;
    outcome: string;
    rows_committed: boolean;
    committed_row_count: number | null;
    credits_charged: number;
    user_comment: string | null;
    photo_path: string | null;
  } | null;
  photo_url: string | null;
}

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'auto_approved', label: 'Auto-approved' },
  { value: 'all', label: 'All' },
] as const;

function RefundsPageInner() {
  const searchParams = useSearchParams();
  // Coming from an Escalations "Review for refund" link — that scan might
  // not be in 'pending' (e.g. already auto-approved), so start on 'all'
  // and let the client-side filter below narrow to just that scan.
  const scanIdFilter = searchParams.get('scanId');
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>(scanIdFilter ? 'all' : 'pending');
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-row partial-approval draft state: amount + note, keyed by refund id.
  const [drafts, setDrafts] = useState<Record<number, { amount: string; note: string }>>({});

  const load = useCallback((status: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/refunds?status=${status}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        return d;
      })
      .then((d) => setRows(d.refunds ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load refund requests'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  function draftFor(r: RefundRow) {
    return drafts[r.id] ?? { amount: String(r.credits_requested), note: '' };
  }
  function setDraft(id: number, patch: Partial<{ amount: string; note: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { amount: '', note: '' }), ...patch } }));
  }

  async function decide(r: RefundRow, decision: 'approve' | 'deny') {
    const draft = draftFor(r);
    const amount = decision === 'approve' ? Number(draft.amount) : undefined;

    if (decision === 'approve') {
      if (!Number.isFinite(amount) || amount! < 0 || amount! > r.credits_requested) {
        setError(`Amount must be between 0 and ${r.credits_requested}`);
        return;
      }
      if (amount! < r.credits_requested && !draft.note.trim()) {
        setError('Add a note explaining the calculation for a partial refund');
        return;
      }
    }

    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refundRequestId: r.id, decision, amount, note: draft.note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save decision');
      // It's no longer pending, so drop it from the current (pending) view;
      // other tabs will pick it up next time they're loaded.
      setRows((prev) => prev.filter((row) => row.id !== r.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save decision');
    } finally {
      setBusyId(null);
    }
  }

  const displayedRows = scanIdFilter ? rows.filter((r) => r.scan_id === scanIdFilter) : rows;

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Refund requests</h1>
      <p className="text-white/40 text-sm mb-4">
        Refunds that couldn&apos;t be auto-approved (inventory was updated from the scan, so it needs a human
        judgment call) — decide each one here. Approve for less than the full amount for a partial refund.
      </p>

      <div className="mb-6 flex gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {scanIdFilter && (
        <p className="mb-4 text-xs text-white/40">
          Showing refund requests linked to scan <span className="text-white/70">{scanIdFilter}</span> —{' '}
          <Link href="/admin/refunds" className="underline hover:text-white/60">
            clear filter
          </Link>
        </p>
      )}

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {loading && <p className="text-white/40 text-sm">Loading…</p>}
      {!loading && displayedRows.length === 0 && (
        <p className="text-white/30 text-sm">
          {scanIdFilter ? 'No refund request found for that scan.' : tab === 'pending' ? 'Nothing pending. 🎉' : 'No refunds here.'}
        </p>
      )}

      <div className="space-y-2">
        {displayedRows.map((r) => {
          const draft = draftFor(r);
          const isPending = r.status === 'pending';
          const isPartialDraft = isPending && Number(draft.amount) < r.credits_requested;

          return (
            <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex gap-4">
              {/* The actual scan photo, same reasoning as Escalations — a
                  refund decision should be judged against what was
                  actually scanned, not just a text reason. */}
              <div className="shrink-0">
                {r.photo_url ? (
                  <button onClick={() => setLightbox(r.photo_url)} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.photo_url}
                      alt="Scan photo"
                      className="w-20 h-20 rounded-lg object-cover border border-white/10 hover:opacity-80 transition"
                    />
                  </button>
                ) : (
                  <div className="w-20 h-20 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                    <span className="text-[10px] text-white/30 text-center px-1">No photo</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <Link href={`/admin/customers/${r.tenant_id}`} className="text-white text-sm font-medium hover:underline">
                    {r.business_name}
                  </Link>
                  <p className="text-white/40 text-xs mt-0.5">
                    {r.scan?.scan_type ?? '—'} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-400">
                  {r.status === 'pending'
                    ? `${r.credits_requested} credits requested`
                    : `${r.credits_approved ?? 0} / ${r.credits_requested} credits`}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/60">
                <div>
                  Inventory updated:{' '}
                  <span className={r.scan?.rows_committed ? 'text-emerald-400' : 'text-red-400'}>
                    {r.scan?.rows_committed ? `Yes (${r.scan.committed_row_count ?? '?'} rows)` : 'No'}
                  </span>
                </div>
                <div>Scan outcome: <span className="text-white/80">{r.scan?.outcome ?? '—'}</span></div>
              </div>

              {r.reason && (
                <p className="mt-3 rounded-lg bg-black/20 p-2.5 text-sm text-white/80">&quot;{r.reason}&quot;</p>
              )}
              {r.scan?.user_comment && r.scan.user_comment !== r.reason && (
                <p className="mt-2 text-xs text-white/40">Also noted at scan time: {r.scan.user_comment}</p>
              )}

              {!isPending && (
                <div className="mt-3 rounded-lg bg-black/20 p-2.5 text-xs text-white/60 space-y-1">
                  <div>
                    {r.status === 'denied' ? 'Denied' : 'Decided'} by {r.decided_by ?? '—'}
                    {r.decided_at ? ` on ${new Date(r.decided_at).toLocaleString()}` : ''}
                  </div>
                  {r.decision_note && <div className="text-white/80">Note: {r.decision_note}</div>}
                </div>
              )}

              {isPending && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/40 shrink-0">Refund amount</label>
                    <input
                      type="number"
                      min={0}
                      max={r.credits_requested}
                      value={draft.amount}
                      onChange={(e) => setDraft(r.id, { amount: e.target.value })}
                      className="w-24 rounded-lg bg-black/30 border border-white/10 px-2 py-1 text-sm text-white"
                    />
                    <span className="text-xs text-white/40">/ {r.credits_requested} requested</span>
                  </div>
                  {isPartialDraft && (
                    <input
                      type="text"
                      placeholder="Required: explain the calculation (e.g. 3 of 5 rows were wrong — refunding 3/5)"
                      value={draft.note}
                      onChange={(e) => setDraft(r.id, { note: e.target.value })}
                      className="w-full rounded-lg bg-black/30 border border-white/10 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30"
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(r, 'approve')}
                      disabled={busyId === r.id}
                      className="flex-1 rounded-lg bg-emerald-500/15 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      {busyId === r.id ? 'Working…' : isPartialDraft ? `Approve partial · ${draft.amount} credits` : `Approve · refund ${r.credits_requested} credits`}
                    </button>
                    <button
                      onClick={() => decide(r, 'deny')}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-white/60 hover:bg-white/10 disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}
              </div>
            </div>
          );
        })}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Scan photo full size" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

export default function RefundsPage() {
  return (
    <Suspense fallback={<p className="text-white/40 text-sm">Loading…</p>}>
      <RefundsPageInner />
    </Suspense>
  );
}
