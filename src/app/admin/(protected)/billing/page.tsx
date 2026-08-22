'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface PendingSub {
  id: number;
  tenant_id: string;
  plan_id: number;
  created_at: string;
  business_name: string;
  plans: { name: string; price_amount: number; currency: string; credits_included: number } | null;
}

interface PendingAddon {
  id: number;
  tenant_id: string;
  addon_id: number;
  purchased_at: string;
  business_name: string;
  addons: { name: string; price_amount: number; currency: string; credits_included: number } | null;
}

export default function AdminBillingPage() {
  const [subs, setSubs] = useState<PendingSub[]>([]);
  const [addons, setAddons] = useState<PendingAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/billing');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setSubs(body.pendingSubs ?? []);
      setAddons(body.pendingAddons ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(tenantId: string, key: string, action: string, extra?: Record<string, unknown>) {
    setBusyId(key);
    try {
      const res = await fetch(`/api/admin/customer/${tenantId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Action failed');
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Billing requests</h1>
      <p className="text-white/40 text-sm mb-6">
        Paid plans and addons awaiting manual payment confirmation — no gateway is wired in yet, so these
        won&apos;t activate or grant credits until approved here or from the tenant&apos;s Customer 360 page.
      </p>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {loading && <p className="text-white/40 text-sm">Loading…</p>}

      {!loading && subs.length === 0 && addons.length === 0 && (
        <p className="text-white/30 text-sm">Nothing pending. 🎉</p>
      )}

      {subs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-white/60 text-xs uppercase tracking-wide font-semibold mb-2">Plan changes</h2>
          <div className="space-y-2">
            {subs.map((s) => {
              const key = `sub-${s.id}`;
              return (
                <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
                  <div>
                    <Link href={`/admin/customers/${s.tenant_id}`} className="text-white text-sm font-medium hover:underline">
                      {s.business_name}
                    </Link>
                    <p className="text-white/50 text-xs mt-0.5">
                      → {s.plans?.name ?? '—'} · {s.plans?.currency} {s.plans?.price_amount} ·{' '}
                      {s.plans?.credits_included} credits · requested {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      disabled={busyId === key}
                      onClick={() => act(s.tenant_id, key, 'approve_pending_plan')}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      Confirm payment
                    </button>
                    <button
                      disabled={busyId === key}
                      onClick={() => act(s.tenant_id, key, 'reject_pending_plan')}
                      className="text-xs px-3 py-1.5 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {addons.length > 0 && (
        <div>
          <h2 className="text-white/60 text-xs uppercase tracking-wide font-semibold mb-2">Addon purchases</h2>
          <div className="space-y-2">
            {addons.map((a) => {
              const key = `addon-${a.id}`;
              return (
                <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-4 flex items-center justify-between">
                  <div>
                    <Link href={`/admin/customers/${a.tenant_id}`} className="text-white text-sm font-medium hover:underline">
                      {a.business_name}
                    </Link>
                    <p className="text-white/50 text-xs mt-0.5">
                      → {a.addons?.name ?? '—'} · {a.addons?.currency} {a.addons?.price_amount} ·{' '}
                      {a.addons?.credits_included} credits · requested {new Date(a.purchased_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      disabled={busyId === key}
                      onClick={() => act(a.tenant_id, key, 'approve_pending_addon', { purchaseId: a.id })}
                      className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                    >
                      Confirm payment
                    </button>
                    <button
                      disabled={busyId === key}
                      onClick={() => act(a.tenant_id, key, 'reject_pending_addon', { purchaseId: a.id })}
                      className="text-xs px-3 py-1.5 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
