'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Escalation {
  id: string;
  scan_type: string;
  outcome: string;
  error: string | null;
  comment: string | null;
  contact_email: string | null;
  user_feedback: string | null;
  user_comment: string | null;
  issue_reason: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  tenant_id: string;
  business_name: string;
  district: string | null;
  photo_url: string | null;
}

const REASON_LABELS: Record<string, string> = {
  wrong_cost: 'Wrong cost/price',
  wrong_qty: 'Wrong quantity',
  wrong_name: 'Wrong item name',
  missing_row: 'Missing a row',
  duplicate_row: 'Duplicate row',
  other: 'Other',
};

const TABS = [
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
] as const;

export default function EscalationsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('unresolved');
  const [rows, setRows] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    const res = await fetch(`/api/admin/escalations?status=${status}`);
    const data = await res.json();
    setRows(data.escalations ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function markResolved(r: Escalation) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/customer/${r.tenant_id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_escalation', scanId: r.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Failed to mark resolved');
        return;
      }
      await load(tab);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Escalation queue</h1>
      <p className="text-white/40 text-sm mb-4">
        Failed OCR scans and user-flagged escalations across all tenants.
      </p>

      <div className="flex gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              tab === t.value ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-white/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-white/40 text-sm">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-white/30 text-sm">{tab === 'unresolved' ? 'Queue is empty. 🎉' : 'Nothing here.'}</p>
      )}

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4 flex gap-4">
            {/* The actual scan photo — this is what the person was told is
                saved as proof, and an admin reviewing a report needs to see
                it, not just a text summary, to judge whether it's valid. */}
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
              <div className="flex justify-between items-start">
                <div>
                  <Link href={`/admin/customers/${r.tenant_id}`} className="text-white text-sm font-medium hover:underline">
                    {r.business_name}
                  </Link>
                  <p className="text-white/40 text-xs mt-0.5">
                    {r.scan_type} · {r.district ?? 'no district'} · {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 shrink-0">
                  {r.outcome.replace('_', ' ')}
                </span>
              </div>
              {r.issue_reason && (
                <span className="mt-2 inline-block text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-400">
                  {REASON_LABELS[r.issue_reason] ?? r.issue_reason}
                </span>
              )}
              {(r.error || r.comment || r.user_comment) && (
                <div className="mt-2 text-sm text-white/60 space-y-1">
                  {r.error && <p>Error: {r.error}</p>}
                  {r.comment && <p>Comment: {r.comment}</p>}
                  {r.user_comment && <p>User feedback: {r.user_comment}</p>}
                </div>
              )}
              {r.resolved && (
                <p className="mt-2 text-xs text-emerald-400">
                  Resolved by {r.resolved_by} · {r.resolved_at ? new Date(r.resolved_at).toLocaleString() : ''}
                </p>
              )}
              <div className="mt-3 flex gap-3">
                <Link
                  href={`/admin/refunds?scanId=${r.id}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  Review for refund
                </Link>
                <Link
                  href={`/admin/customers/${r.tenant_id}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-white/60 hover:bg-white/10"
                >
                  Fix inventory instead
                </Link>
                {!r.resolved && (
                  <button
                    disabled={busyId === r.id}
                    onClick={() => markResolved(r)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-white/60 hover:bg-white/10 disabled:opacity-50"
                  >
                    {busyId === r.id ? 'Marking…' : 'Mark resolved'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
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
