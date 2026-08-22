'use client';

import { useEffect, useState } from 'react';

interface LineItem {
  id: number;
  product_id: number | null;
  action: string;
  product_name: string;
  qty: number | null;
  before_stock: number | null;
  after_stock: number | null;
  before_avg_cost: number | null;
  after_avg_cost: number | null;
  before_sell_price: number | null;
  after_sell_price: number | null;
}

interface DetailResponse {
  refund: {
    id: number;
    credits_requested: number;
    credits_approved: number | null;
    status: string;
    reason: string | null;
    created_at: string;
    business_name: string;
  };
  scan: { id: string; scan_type: string; outcome: string; rows_committed: boolean; user_comment: string | null } | null;
  photoUrl: string | null;
  lineItems: LineItem[];
}

const ACTION_LABELS: Record<string, string> = {
  stock_in: 'Stock added',
  sale: 'Sale recorded',
  product_created: 'New item created',
  price_update: 'Price changed',
};

// Photo on the left (zoomable), the real recorded before/after inventory
// change on the right, each row quick-editable in place. This is
// specifically to cut through "user can falsely accuse" — the admin
// checks the claim against the actual photo and the actual diff, not
// just the tenant's text description, before approving or denying money.
export default function RefundReviewModal({
  refundId,
  tenantId,
  onClose,
  onDecided,
}: {
  refundId: number;
  tenantId: string;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ stock: string; avg_cost: string; sell_price: string }>({
    stock: '',
    avg_cost: '',
    sell_price: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [partialAmount, setPartialAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/refunds/${refundId}/detail`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) setError(body.error);
        else setData(body);
      })
      .finally(() => setLoading(false));
  }, [refundId]);

  function startEdit(li: LineItem) {
    if (!li.product_id) return;
    setEditingProductId(li.product_id);
    setDraft({
      stock: String(li.after_stock ?? ''),
      avg_cost: String(li.after_avg_cost ?? ''),
      sell_price: String(li.after_sell_price ?? ''),
    });
  }

  async function saveEdit(li: LineItem) {
    if (!li.product_id) return;
    setSavingEdit(true);
    try {
      const patch: Record<string, unknown> = { action: 'update_product', productId: li.product_id };
      if (draft.stock !== '') patch.stock = Number(draft.stock);
      if (draft.avg_cost !== '') patch.avg_cost = Number(draft.avg_cost);
      if (draft.sell_price !== '') patch.sell_price = Number(draft.sell_price);
      const res = await fetch(`/api/admin/customer/${tenantId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Could not save');
        return;
      }
      setEditingProductId(null);
    } finally {
      setSavingEdit(false);
    }
  }

  async function decide(action: 'approve' | 'deny') {
    setDecisionBusy(true);
    try {
      const res = await fetch('/api/admin/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundRequestId: refundId,
          decision: action,
          amount: partialAmount ? Number(partialAmount) : undefined,
          note: note.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || 'Action failed');
        return;
      }
      onDecided();
      onClose();
    } finally {
      setDecisionBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <p className="text-white/40 text-sm p-8">Loading…</p>}
        {error && <p className="text-red-400 text-sm p-8">{error}</p>}

        {data && (
          <>
            <div className="w-[45%] bg-black flex items-center justify-center p-4 border-r border-white/10">
              {data.photoUrl ? (
                <button onClick={() => setZoomed(true)} className="block max-h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.photoUrl} alt="Scan photo" className="max-h-[75vh] rounded-lg object-contain hover:opacity-90 transition" />
                </button>
              ) : (
                <div className="text-center text-white/30 text-sm">
                  No photo saved for this scan.
                  <br />
                  (Bucket may not have existed at the time — see migration-create-scans-bucket.sql.)
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-white text-base font-semibold">{data.refund.business_name}</h2>
                  <p className="text-white/40 text-xs mt-0.5">
                    {data.scan?.scan_type ?? '—'} · {new Date(data.refund.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-400">{data.refund.status}</span>
              </div>

              {data.refund.reason && (
                <div className="mb-4 rounded-lg bg-white/5 p-3">
                  <p className="text-white/40 text-xs mb-1">Tenant&apos;s stated reason</p>
                  <p className="text-white/80 text-sm">{data.refund.reason}</p>
                </div>
              )}

              <p className="text-white/40 text-xs uppercase tracking-wide mb-2">
                What this scan actually changed {data.scan && !data.scan.rows_committed && '(nothing saved to inventory)'}
              </p>

              {data.lineItems.length === 0 ? (
                <p className="text-white/30 text-sm mb-4">
                  {data.scan?.rows_committed
                    ? 'No line-item detail recorded for this scan (saved before this tracking existed).'
                    : 'Nothing was saved to inventory from this scan.'}
                </p>
              ) : (
                <div className="space-y-2 mb-4">
                  {data.lineItems.map((li) => {
                    const isEditing = editingProductId === li.product_id;
                    return (
                      <div key={li.id} className="rounded-lg bg-white/5 p-3">
                        <div className="flex justify-between items-start mb-1.5">
                          <div>
                            <p className="text-white text-sm font-medium">{li.product_name}</p>
                            <p className="text-white/40 text-xs">{ACTION_LABELS[li.action] ?? li.action}</p>
                          </div>
                          {li.product_id && !isEditing && (
                            <button
                              onClick={() => startEdit(li)}
                              className="text-xs px-2 py-1 rounded border border-white/15 text-white/60 hover:bg-white/10"
                            >
                              Quick fix
                            </button>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="space-y-1.5 mt-2">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-16 text-white/40">Stock</span>
                              <input
                                value={draft.stock}
                                onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value }))}
                                className="flex-1 rounded bg-white/10 border border-white/10 px-2 py-1 text-white outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-16 text-white/40">Cost</span>
                              <input
                                value={draft.avg_cost}
                                onChange={(e) => setDraft((d) => ({ ...d, avg_cost: e.target.value }))}
                                className="flex-1 rounded bg-white/10 border border-white/10 px-2 py-1 text-white outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-16 text-white/40">Sell</span>
                              <input
                                value={draft.sell_price}
                                onChange={(e) => setDraft((d) => ({ ...d, sell_price: e.target.value }))}
                                className="flex-1 rounded bg-white/10 border border-white/10 px-2 py-1 text-white outline-none"
                              />
                            </div>
                            <div className="flex gap-1.5 pt-1">
                              <button
                                disabled={savingEdit}
                                onClick={() => saveEdit(li)}
                                className="text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                disabled={savingEdit}
                                onClick={() => setEditingProductId(null)}
                                className="text-xs px-2 py-1 rounded bg-white/5 text-white/50 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 text-xs mt-1.5">
                            {li.before_stock !== null && (
                              <div>
                                <span className="text-white/30">Stock </span>
                                <span className="text-white/70">
                                  {li.before_stock} → {li.after_stock}
                                </span>
                              </div>
                            )}
                            {li.before_avg_cost !== null && (
                              <div>
                                <span className="text-white/30">Cost </span>
                                <span className={li.before_avg_cost === 0 || li.after_avg_cost === 0 ? 'text-amber-400' : 'text-white/70'}>
                                  {li.before_avg_cost} → {li.after_avg_cost}
                                </span>
                              </div>
                            )}
                            {li.before_sell_price !== null && (
                              <div>
                                <span className="text-white/30">Sell </span>
                                <span className="text-white/70">
                                  {li.before_sell_price} → {li.after_sell_price}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {data.refund.status === 'pending' && (
                <div className="border-t border-white/10 pt-4 mt-2">
                  <div className="flex gap-2 mb-2">
                    <input
                      placeholder={`Partial amount (default: full ${data.refund.credits_requested})`}
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      className="flex-1 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-xs outline-none"
                    />
                  </div>
                  <input
                    placeholder="Decision note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-xs outline-none mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={decisionBusy}
                      onClick={() => decide('approve')}
                      className="flex-1 rounded-lg bg-emerald-500/15 text-emerald-400 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {decisionBusy ? 'Working…' : `Approve · ${partialAmount || data.refund.credits_requested} credits`}
                    </button>
                    <button
                      disabled={decisionBusy}
                      onClick={() => decide('deny')}
                      className="flex-1 rounded-lg bg-white/5 text-white/60 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              )}

              <button onClick={onClose} className="mt-4 text-xs text-white/40 hover:text-white/60">
                Close
              </button>
            </div>
          </>
        )}
      </div>

      {zoomed && data?.photoUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-6"
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.photoUrl} alt="Scan photo full size" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
