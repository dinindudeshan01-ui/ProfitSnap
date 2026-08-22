'use client';

import { useEffect, useState, useCallback, use } from 'react';
import ShopSnaps from '@/components/admin/ShopSnaps';
import RefundReviewModal from '@/components/admin/RefundReviewModal';

interface Customer360 {
  tenant: {
    id: string;
    business_name: string;
    owner_name: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    locale: string | null;
    created_at: string;
  };
  wallet: { balance: number; updated_at: string } | null;
  recentTransactions: Array<{
    id: number;
    type: string;
    amount: number;
    balance_after: number;
    note: string | null;
    created_at: string;
  }>;
  recentScans: Array<{
    id: string;
    scan_type: string;
    outcome: string;
    credits_charged: number;
    rows_committed: boolean;
    created_at: string;
  }>;
  scanErrorRate: number;
  refundRequests: Array<{
    id: number;
    credits_requested: number;
    status: string;
    reason: string | null;
    created_at: string;
  }>;
  supportNotes: Array<{ id: number; admin_email: string; note: string; created_at: string }>;
  products: Array<{
    id: number;
    code: string;
    name: string;
    unit: string;
    avg_cost: number;
    sell_price: number;
    stock: number;
    created_at: string;
  }>;
  productCount: number;
  salesCount: number;
  duplicateFlags: Array<{
    id: number;
    match_reason: 'device' | 'ip' | 'both';
    status: string;
    appeal_note: string | null;
    appeal_submitted_at: string | null;
    created_at: string;
    tenant_id: string;
    matched_tenant_id: string;
    tenant: { business_name: string };
    matched_tenant: { business_name: string };
  }>;
  pendingSubscription: {
    id: number;
    plan_id: number;
    created_at: string;
    plans: { name: string; price_amount: number; currency: string; credits_included: number } | null;
  } | null;
  pendingAddons: Array<{
    id: number;
    addon_id: number;
    purchased_at: string;
    addons: { name: string; price_amount: number; currency: string; credits_included: number } | null;
  }>;
}

export default function Customer360Page({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(params);
  const [data, setData] = useState<Customer360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState<{ name: string; avg_cost: string; sell_price: string; stock: string }>({
    name: '',
    avg_cost: '',
    sell_price: '',
    stock: '',
  });
  const [productBusy, setProductBusy] = useState(false);
  const [reviewRefundId, setReviewRefundId] = useState<number | null>(null);
  const [productError, setProductError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/customer/${tenantId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Failed to load customer');
      setLoading(false);
      return;
    }
    setData(await res.json());
    setError(null);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/customer/${tenantId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Action failed');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function decideDuplicate(flagId: number, decision: 'dismiss' | 'penalize' | 'suspend') {
    if (decision === 'suspend' && !confirm('Suspend both accounts?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, decision }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Action failed');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  function startEditProduct(p: Customer360['products'][number]) {
    setEditingProductId(p.id);
    setProductError(null);
    setProductDraft({
      name: p.name,
      avg_cost: String(p.avg_cost),
      sell_price: String(p.sell_price),
      stock: String(p.stock),
    });
  }

  async function saveProduct(productId: number) {
    const avg_cost = Number(productDraft.avg_cost);
    const sell_price = Number(productDraft.sell_price);
    const stock = Number(productDraft.stock);
    if (!productDraft.name.trim()) {
      setProductError('Name cannot be empty');
      return;
    }
    if ([avg_cost, sell_price, stock].some((n) => !Number.isFinite(n) || n < 0)) {
      setProductError('Cost, sell price, and stock must be non-negative numbers');
      return;
    }
    setProductBusy(true);
    setProductError(null);
    try {
      const res = await fetch(`/api/admin/customer/${tenantId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_product',
          productId,
          name: productDraft.name.trim(),
          avg_cost,
          sell_price,
          stock,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setProductError(body.error || 'Could not save changes');
        return;
      }
      setEditingProductId(null);
      await load();
    } finally {
      setProductBusy(false);
    }
  }

  async function handleBillingAction(action: string, extra?: Record<string, unknown>) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  if (loading) return <p className="text-white/40 text-sm">Loading…</p>;
  if (error || !data) return <p className="text-red-400 text-sm">{error}</p>;

  const { tenant, wallet } = data;

  return (
    <div className="space-y-6">
      {/* Duplicate-shop flags — same three actions as the Duplicates tab,
          but right here so an admin who found this shop via search/map
          doesn't need to go find it again on another page. */}
      {data.duplicateFlags.length > 0 && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 space-y-4">
          <p className="text-red-400 text-sm font-semibold">
            ⚠ Flagged as a possible duplicate shop ({data.duplicateFlags.length} pending)
          </p>
          {data.duplicateFlags.map((f) => {
            const otherName = f.tenant_id === tenantId ? f.matched_tenant.business_name : f.tenant.business_name;
            return (
              <div key={f.id} className="rounded-lg bg-black/20 p-3.5">
                <p className="text-white text-sm">
                  Matches <span className="font-semibold">{otherName}</span> — {f.match_reason} match, flagged{' '}
                  {new Date(f.created_at).toLocaleDateString()}
                </p>
                {f.appeal_note && (
                  <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                    <p className="text-[11px] font-semibold text-amber-400">
                      Shop&apos;s explanation{f.appeal_submitted_at ? ` · ${new Date(f.appeal_submitted_at).toLocaleString()}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-white/80">{f.appeal_note}</p>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy}
                    onClick={() => decideDuplicate(f.id, 'dismiss')}
                    className="flex-1 rounded-lg bg-white/5 py-2 text-xs font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
                  >
                    Dismiss · release credits
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => decideDuplicate(f.id, 'penalize')}
                    className="flex-1 rounded-lg bg-amber-500/15 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
                  >
                    Penalize
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => decideDuplicate(f.id, 'suspend')}
                    className="flex-1 rounded-lg bg-red-500/15 py-2 text-xs font-medium text-red-400 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    Suspend both
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-white text-xl font-semibold">{tenant.business_name}</h1>
            <p className="text-white/40 text-sm mt-1">
              {tenant.owner_name || '—'} · {tenant.phone || '—'} · {tenant.email || '—'}
            </p>
            <p className="text-white/30 text-xs mt-1">
              ID: {tenant.id} · Customer since {new Date(tenant.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={tenant.status} />
            {tenant.status !== 'suspended' ? (
              <button
                disabled={busy}
                onClick={() => runAction('set_status', { status: 'suspended' })}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              >
                Suspend
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => runAction('set_status', { status: 'active' })}
                className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
              >
                Reinstate
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-5 pt-5 border-t border-white/10">
          <Stat label="Credit balance" value={wallet?.balance ?? 0} />
          <Stat label="Products" value={data.productCount} />
          <Stat label="Sales recorded" value={data.salesCount} />
          <Stat
            label="Scan error rate"
            value={`${(data.scanErrorRate * 100).toFixed(1)}%`}
            warn={data.scanErrorRate > 0.1}
          />
        </div>
      </div>

      {/* Credit adjustment */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-white text-sm font-semibold mb-3">Adjust credits</h2>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Amount (+/-)"
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            className="w-40 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30"
          />
          <input
            placeholder="Reason (required)"
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            className="flex-1 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30"
          />
          <button
            disabled={busy || !adjustAmount || !adjustReason}
            onClick={async () => {
              await runAction('adjust_credits', { amount: Number(adjustAmount), reason: adjustReason });
              setAdjustAmount('');
              setAdjustReason('');
            }}
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-40"
          >
            Apply
          </button>
        </div>
        <p className="text-white/30 text-xs mt-2">
          Every adjustment is logged to the ledger and the audit trail with your account.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Transactions */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-white text-sm font-semibold mb-3">Transaction history</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {data.recentTransactions.length === 0 && (
              <p className="text-white/30 text-sm">No transactions yet.</p>
            )}
            {data.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex justify-between text-sm border-b border-white/5 pb-2">
                <div>
                  <p className="text-white/80">{tx.type}</p>
                  <p className="text-white/30 text-xs">{tx.note || '—'}</p>
                </div>
                <div className="text-right">
                  <p className={tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {tx.amount >= 0 ? '+' : ''}
                    {tx.amount}
                  </p>
                  <p className="text-white/30 text-xs">bal {tx.balance_after}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scans */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-white text-sm font-semibold mb-3">Recent scans</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {data.recentScans.length === 0 && <p className="text-white/30 text-sm">No scans yet.</p>}
            {data.recentScans.map((s) => (
              <div key={s.id} className="flex justify-between text-sm border-b border-white/5 pb-2">
                <div>
                  <p className="text-white/80">{s.scan_type}</p>
                  <p className="text-white/30 text-xs">{new Date(s.created_at).toLocaleString()}</p>
                </div>
                <OutcomeBadge outcome={s.outcome} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <ShopSnaps tenantId={tenantId} />

      {(data.pendingSubscription || data.pendingAddons.length > 0) && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="text-amber-400 text-sm font-semibold mb-3">
            Awaiting payment confirmation
          </h2>
          <p className="text-white/40 text-xs mb-3">
            No payment gateway is wired in yet — confirm payment was actually received (bank transfer,
            cash, etc.) before approving. Approving grants the plan/addon&apos;s included credits immediately.
          </p>
          <div className="space-y-2">
            {data.pendingSubscription && (
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-white text-sm font-medium">
                    Plan: {data.pendingSubscription.plans?.name ?? '—'}
                  </p>
                  <p className="text-white/40 text-xs">
                    {data.pendingSubscription.plans?.currency} {data.pendingSubscription.plans?.price_amount} ·{' '}
                    {data.pendingSubscription.plans?.credits_included} credits · requested{' '}
                    {new Date(data.pendingSubscription.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={busy}
                    onClick={() => handleBillingAction('approve_pending_plan')}
                    className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Confirm payment
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => handleBillingAction('reject_pending_plan')}
                    className="text-xs px-3 py-1.5 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
            {data.pendingAddons.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5">
                <div>
                  <p className="text-white text-sm font-medium">Addon: {a.addons?.name ?? '—'}</p>
                  <p className="text-white/40 text-xs">
                    {a.addons?.currency} {a.addons?.price_amount} · {a.addons?.credits_included} credits ·
                    requested {new Date(a.purchased_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    disabled={busy}
                    onClick={() => handleBillingAction('approve_pending_addon', { purchaseId: a.id })}
                    className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    Confirm payment
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => handleBillingAction('reject_pending_addon', { purchaseId: a.id })}
                    className="text-xs px-3 py-1.5 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inventory — lets an admin correct a bad OCR read (e.g. cost came
          back as 0 or a quantity was misread) directly, as an alternative
          to a refund. Escalations link here with "Fix inventory instead". */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white text-sm font-semibold">Inventory ({data.productCount})</h2>
          <input
            placeholder="Search by name or code…"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            className="w-56 rounded-lg bg-white/10 border border-white/10 px-3 py-1.5 text-white text-xs outline-none focus:border-white/30"
          />
        </div>
        {productError && <p className="text-red-400 text-xs mb-2">{productError}</p>}
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs text-left border-b border-white/10">
                <th className="pb-2 font-medium">Code</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium text-right">Cost</th>
                <th className="pb-2 font-medium text-right">Sell</th>
                <th className="pb-2 font-medium text-right">Stock</th>
                <th className="pb-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {data.products
                .filter((p) => {
                  const q = productQuery.trim().toLowerCase();
                  if (!q) return true;
                  return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
                })
                .map((p) => {
                  const isEditing = editingProductId === p.id;
                  return (
                    <tr key={p.id} className="border-b border-white/5">
                      <td className="py-2 text-white/50 text-xs">{p.code || '—'}</td>
                      <td className="py-2 text-white/80">
                        {isEditing ? (
                          <input
                            value={productDraft.name}
                            onChange={(e) => setProductDraft((d) => ({ ...d, name: e.target.value }))}
                            className="w-full rounded bg-white/10 border border-white/10 px-2 py-1 text-white text-xs outline-none"
                          />
                        ) : (
                          p.name
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={productDraft.avg_cost}
                            onChange={(e) => setProductDraft((d) => ({ ...d, avg_cost: e.target.value }))}
                            className="w-20 rounded bg-white/10 border border-white/10 px-2 py-1 text-white text-xs text-right outline-none"
                          />
                        ) : (
                          <span className={p.avg_cost === 0 ? 'text-amber-400' : 'text-white/80'}>{p.avg_cost}</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={productDraft.sell_price}
                            onChange={(e) => setProductDraft((d) => ({ ...d, sell_price: e.target.value }))}
                            className="w-20 rounded bg-white/10 border border-white/10 px-2 py-1 text-white text-xs text-right outline-none"
                          />
                        ) : (
                          <span className="text-white/80">{p.sell_price}</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={productDraft.stock}
                            onChange={(e) => setProductDraft((d) => ({ ...d, stock: e.target.value }))}
                            className="w-20 rounded bg-white/10 border border-white/10 px-2 py-1 text-white text-xs text-right outline-none"
                          />
                        ) : (
                          <span className="text-white/80">{p.stock}</span>
                        )}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex gap-1.5 justify-end">
                            <button
                              disabled={productBusy}
                              onClick={() => saveProduct(p.id)}
                              className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              disabled={productBusy}
                              onClick={() => setEditingProductId(null)}
                              className="text-xs px-2 py-1 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditProduct(p)}
                            className="text-xs px-2 py-1 rounded border border-white/15 text-white/60 hover:bg-white/10"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {data.products.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-white/30 text-sm">
                    No products yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data.productCount > data.products.length && (
          <p className="text-white/30 text-xs mt-2">
            Showing the {data.products.length} most recent of {data.productCount} products.
          </p>
        )}
      </div>

      {/* Refunds */}
      {data.refundRequests.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-white text-sm font-semibold mb-3">Refund requests</h2>
          <div className="space-y-2">
            {data.refundRequests.map((r) => (
              <button
                key={r.id}
                onClick={() => setReviewRefundId(r.id)}
                className="flex w-full justify-between text-sm border-b border-white/5 pb-2 text-left hover:bg-white/5 rounded px-1 -mx-1 transition"
              >
                <div>
                  <p className="text-white/80">{r.reason || '—'}</p>
                  <p className="text-white/30 text-xs">{new Date(r.created_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/80">{r.credits_requested} credits</p>
                  <p className="text-white/30 text-xs">{r.status}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Support notes */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-white text-sm font-semibold mb-3">Support notes</h2>
        <div className="flex gap-2 mb-4">
          <input
            placeholder="Add a note (e.g. 'Called about stock mismatch, refunded 5 credits, ticket #42')"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30"
          />
          <button
            disabled={busy || !note.trim()}
            onClick={async () => {
              await runAction('add_note', { note });
              setNote('');
            }}
            className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.supportNotes.length === 0 && <p className="text-white/30 text-sm">No notes yet.</p>}
          {data.supportNotes.map((n) => (
            <div key={n.id} className="text-sm border-b border-white/5 pb-2">
              <p className="text-white/80">{n.note}</p>
              <p className="text-white/30 text-xs mt-0.5">
                {n.admin_email} · {new Date(n.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      {reviewRefundId !== null && (
        <RefundReviewModal
          refundId={reviewRefundId}
          tenantId={tenantId}
          onClose={() => setReviewRefundId(null)}
          onDecided={load}
        />
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <p className="text-white/40 text-xs">{label}</p>
      <p className={`text-lg font-semibold ${warn ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400',
    suspended: 'bg-red-500/15 text-red-400',
    trial: 'bg-amber-500/15 text-amber-400',
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${styles[status] ?? 'bg-white/10 text-white/50'}`}>
      {status}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const styles: Record<string, string> = {
    ocr_success: 'bg-emerald-500/15 text-emerald-400',
    ocr_failed: 'bg-red-500/15 text-red-400',
    staff_escalation: 'bg-amber-500/15 text-amber-400',
    user_reported_issue: 'bg-orange-500/15 text-orange-400',
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full h-fit ${styles[outcome] ?? 'bg-white/10 text-white/50'}`}>
      {outcome.replace('_', ' ')}
    </span>
  );
}
