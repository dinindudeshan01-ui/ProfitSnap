'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface TenantRef {
  id: string;
  business_name: string;
  email: string | null;
  signup_device_id: string | null;
  signup_ip: string | null;
  created_at: string;
}

interface Flag {
  id: number;
  match_reason: 'device' | 'ip' | 'both';
  status: string;
  credits_held: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  appeal_note: string | null;
  appeal_submitted_at: string | null;
  tenant: TenantRef;
  matched_tenant: TenantRef;
}

const TABS = ['pending', 'dismissed', 'penalized', 'suspended', 'all'] as const;

export default function DuplicatesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('pending');
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((status: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/admin/duplicates?status=${status}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `Failed to load (${r.status})`);
        return d;
      })
      .then((d) => setFlags(d.flags ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function decide(flagId: number, decision: 'dismiss' | 'penalize' | 'suspend') {
    if (decision === 'suspend' && !confirm('Suspend both accounts? This is hard to walk back cleanly.')) return;
    setBusyId(flagId);
    setError(null);
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save decision');
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save decision');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Duplicate shops</h1>
      <p className="text-white/40 text-sm mb-4">
        Signups sharing a device or IP with an existing shop — usually free-trial abuse, sometimes a shared
        wifi/tablet with two real shops. Trial credits are held automatically until you decide.
      </p>

      <div className="mb-6 flex gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t ? 'border-white text-white' : 'border-transparent text-white/40 hover:text-white/70'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {loading && <p className="text-white/40 text-sm">Loading…</p>}
      {!loading && flags.length === 0 && <p className="text-white/30 text-sm">Nothing here.</p>}

      <div className="space-y-2">
        {flags.map((f) => (
          <div key={f.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="grid grid-cols-2 gap-6">
                <TenantBlock label="New signup" t={f.tenant} />
                <TenantBlock label="Matches existing" t={f.matched_tenant} />
              </div>
              <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 capitalize">
                {f.match_reason} match
              </span>
            </div>

            {f.appeal_note && (
              <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                <p className="text-[11px] font-semibold text-amber-400">
                  Shop&apos;s explanation{f.appeal_submitted_at ? ` · ${new Date(f.appeal_submitted_at).toLocaleString()}` : ''}
                </p>
                <p className="mt-1 text-xs text-white/80">{f.appeal_note}</p>
              </div>
            )}

            {f.status !== 'pending' ? (
              <p className="mt-3 text-xs text-white/50">
                {f.status} by {f.reviewed_by ?? '—'} {f.reviewed_at ? `on ${new Date(f.reviewed_at).toLocaleString()}` : ''}
              </p>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => decide(f.id, 'dismiss')}
                  disabled={busyId === f.id}
                  className="flex-1 rounded-lg bg-white/5 py-2 text-sm font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
                >
                  Dismiss · release held credits
                </button>
                <button
                  onClick={() => decide(f.id, 'penalize')}
                  disabled={busyId === f.id}
                  className="flex-1 rounded-lg bg-amber-500/15 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  Penalize · deduct 50 credits
                </button>
                <button
                  onClick={() => decide(f.id, 'suspend')}
                  disabled={busyId === f.id}
                  className="flex-1 rounded-lg bg-red-500/15 py-2 text-sm font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Suspend both
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TenantBlock({ label, t }: { label: string; t: TenantRef }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-white/30">{label}</p>
      <Link href={`/admin/customers/${t.id}`} className="text-white text-sm font-medium hover:underline">
        {t.business_name}
      </Link>
      <p className="text-white/40 text-xs">{t.email}</p>
      <p className="text-white/30 text-[11px] mt-0.5">
        Signed up {new Date(t.created_at).toLocaleDateString()} · IP {t.signup_ip ?? '—'}
      </p>
    </div>
  );
}
