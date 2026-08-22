'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Camera } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAllProducts, applyStockIn, reverseStockIn } from '@/lib/db/queries';
import { Product } from '@/lib/types';
import { useLang } from '@/lib/i18n/LangContext';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import { useToast } from '@/components/Toast';
import ArcHeader from '@/components/ArcHeader';
import UnitIcon from '@/components/UnitIcon';
import DataLoadError from '@/components/DataLoadError';
import PressableButton from '@/components/PressableButton';
import { colors, unitColor } from '@/lib/theme';
import { useOnline } from '@/lib/useOnline';
import { enqueueAction, flushQueue, getQueuedActions } from '@/lib/offlineQueue';

interface Entry {
  qty: string;
  cost: string;
}

export default function StockScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { currency } = useCurrency();
  const showToast = useToast();
  const supabase = createClient();
  const online = useOnline();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<1 | 2>(1);
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same short-lived "oops" pattern as SalesScreen's lastBatch — holds
  // what's needed to precisely undo the batch just submitted.
  const [lastBatch, setLastBatch] = useState<{
    entries: { stockInId: number; pid: number; previousStock: number; previousAvgCost: number }[];
    itemCount: number;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getAllProducts(supabase);
      setProducts(rows);
    } catch (err) {
      console.error('StockScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load products');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    setStep(1);
    setSelected(new Set());
    setEntries({});
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.stock} />;
  }

  const filtered = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

  function toggle(pid: number) {
    setLastBatch(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function goToStep2() {
    const initial: Record<number, Entry> = {};
    products.forEach((p) => {
      if (selected.has(p.id)) initial[p.id] = { qty: '', cost: String(p.avg_cost) };
    });
    setEntries(initial);
    setStep(2);
  }

  function updateEntry(pid: number, field: keyof Entry, value: string) {
    setEntries((e) => ({ ...e, [pid]: { ...e[pid], [field]: value } }));
  }

  const [queuedCount, setQueuedCount] = useState(0);

  const refreshQueuedCount = useCallback(async () => {
    const queued = await getQueuedActions('stock_in');
    setQueuedCount(queued.length);
  }, []);

  useEffect(() => {
    refreshQueuedCount();
  }, [refreshQueuedCount]);

  // Same reasoning as SalesScreen's processSaleItem — replays a queued
  // stock-in through the exact same write applyStockIn already does live,
  // so a queued entry behaves identically to a live one once it syncs.
  // Undo info isn't captured here (unlike the live path below) since
  // background-synced items aren't part of an active "just made a
  // mistake" moment the Undo banner is for.
  const processStockInItem = useCallback(
    async (payload: unknown) => {
      const item = payload as { pid: number; qty: number; cost: number };
      await applyStockIn(supabase, item.pid, item.qty, item.cost);
    },
    [supabase]
  );

  const syncQueue = useCallback(async () => {
    const { succeeded } = await flushQueue('stock_in', processStockInItem);
    if (succeeded > 0) {
      showToast(`Synced ${succeeded} queued stock-in entr${succeeded === 1 ? 'y' : 'ies'} from earlier`);
      load();
    }
    refreshQueuedCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processStockInItem]);

  useEffect(() => {
    if (online) syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function handleSubmit() {
    if (!online) {
      // Queue every entry instead of failing outright — syncs
      // automatically the moment connectivity returns.
      for (const [pidStr, { qty, cost }] of Object.entries(entries)) {
        const pid = Number(pidStr);
        const p = products.find((x) => x.id === pid);
        const qtyNum = parseFloat(qty) || 0;
        const costNum = parseFloat(cost) || (p ? p.avg_cost : 0);
        if (qtyNum <= 0) continue;
        await enqueueAction('stock_in', { pid, qty: qtyNum, cost: costNum });
      }
      setEntries({});
      setSelected(new Set());
      setStep(1);
      await refreshQueuedCount();
      showToast("You're offline — entries saved and will sync automatically");
      return;
    }
    setSubmitting(true);
    const succeeded: number[] = [];
    const undoInfo: { stockInId: number; pid: number; previousStock: number; previousAvgCost: number }[] = [];
    try {
      for (const [pidStr, { qty, cost }] of Object.entries(entries)) {
        const pid = Number(pidStr);
        const p = products.find((x) => x.id === pid);
        const qtyNum = parseFloat(qty) || 0;
        const costNum = parseFloat(cost) || (p ? p.avg_cost : 0);
        if (qtyNum <= 0) continue;
        const result = await applyStockIn(supabase, pid, qtyNum, costNum);
        undoInfo.push({ stockInId: result.stockInId, pid, previousStock: result.previousStock, previousAvgCost: result.previousAvgCost });
        succeeded.push(pid);
      }
      setLastBatch({ entries: undoInfo, itemCount: succeeded.length });
      setEntries({});
      setSelected(new Set());
      setStep(1);
      // Not navigating away here — same as Sales, the "Undo" confirmation
      // needs to stay visible in case of an immediate mistake. "Done"
      // navigates away.
    } catch (err) {
      // Same partial-failure handling as Sales: rows already applied to
      // `products` can't be safely retried (their qty/avg_cost would be
      // double-applied), so drop only those entries and stay on this
      // screen so the user can see and retry what's left.
      setEntries((e) => {
        const next = { ...e };
        for (const pid of succeeded) delete next[pid];
        return next;
      });
      const attempted = Object.values(entries).filter((v) => (parseFloat(v.qty) || 0) > 0).length;
      const remaining = attempted - succeeded.length;
      showToast(
        succeeded.length > 0
          ? `Saved ${succeeded.length} of ${attempted} — ${remaining} failed, please try again`
          : err instanceof Error
          ? err.message
          : 'Could not update stock — please try again'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function undoLastBatch() {
    if (!lastBatch) return;
    setUndoing(true);
    try {
      for (const entry of lastBatch.entries) {
        await reverseStockIn(supabase, entry);
      }
      showToast('Stock-in undone — products restored');
      setLastBatch(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not undo — please check Items manually');
    } finally {
      setUndoing(false);
    }
  }

  const selectedList = products.filter((p) => selected.has(p.id));

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title={t.stockIn} subtitle={t.screenStockSub} color={colors.stock} onBack={() => router.push('/')} />

      <div className="px-4 pt-3">
        <button onClick={() => router.push('/stock/history')} className="text-xs font-semibold" style={{ color: colors.stock }}>
          View stock-in history →
        </button>
      </div>

      {lastBatch && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Saved {lastBatch.itemCount} item{lastBatch.itemCount === 1 ? '' : 's'} ✓
            </p>
            <p className="text-xs text-sub">Made a mistake? You can undo this.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={undoLastBatch}
              disabled={undoing}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: `${colors.danger}18`, color: colors.danger }}
            >
              {undoing ? 'Undoing…' : 'Undo'}
            </button>
            <button
              onClick={() => router.push('/')}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: colors.stock }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {step === 1 ? (
        <>
          <div className="flex-1 px-4 pt-4">
            <div className="mb-2.5 flex h-12 items-center gap-2.5 rounded-xl bg-white px-3.5 shadow-sm">
              <Search size={18} color={colors.sub} />
              <input
                className="flex-1 bg-transparent text-[15px] text-foreground outline-none"
                placeholder={t.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              onClick={() => router.push('/scan?type=stock_in')}
              className="mb-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 shadow-sm active:opacity-85"
            >
              <Camera size={18} color={colors.stock} />
              <span className="text-[13px] font-semibold" style={{ color: colors.stock }}>
                Snap your stock sheet instead
              </span>
            </button>

            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sub">{t.selectRestock}</h2>

            <div className="space-y-2 pb-4">
              {loading ? (
                <p className="py-10 text-center text-sm text-sub">Loading…</p>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center py-14">
                  <p className="text-center text-sm text-sub">{t.noProductsYet}</p>
                </div>
              ) : (
                filtered.map((p) => {
                  const isSelected = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className="flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left shadow-sm"
                      style={{
                        borderColor: isSelected ? colors.stock : 'transparent',
                        backgroundColor: isSelected ? colors.stockLight : 'white',
                      }}
                    >
                      <div
                        className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px]"
                        style={{ backgroundColor: `${unitColor(p.unit)}18` }}
                      >
                        <UnitIcon unit={p.unit} size={18} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-foreground">{p.name}</div>
                        <div className="mt-0.5 text-[11px] text-sub">
                          {t.currentStock}: {p.stock} {p.unit}
                        </div>
                      </div>
                      <div
                        className="h-6 w-6 rounded-[7px] border-2"
                        style={{
                          backgroundColor: isSelected ? colors.stock : 'transparent',
                          borderColor: isSelected ? colors.stock : colors.border,
                        }}
                      />
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div className="px-4 pb-8 pt-2">
            <button
              onClick={goToStep2}
              disabled={selected.size === 0}
              className="w-full rounded-2xl py-[17px] text-base font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: colors.stock }}
            >
              {t.next}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 px-4 pt-4">
            <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sub">{t.enterQty}</h2>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b" style={{ borderColor: colors.border }}>
                      <Th>Code</Th>
                      <Th wide>Item</Th>
                      <Th>Unit</Th>
                      <Th>Cost</Th>
                      <Th>Sell</Th>
                      <Th>{t.qty}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedList.map((p, i) => (
                      <tr
                        key={p.id}
                        className={i !== selectedList.length - 1 ? 'border-b' : ''}
                        style={{ borderColor: colors.border }}
                      >
                        <Td>
                          <span className="text-[12px] text-sub">{p.code || '—'}</span>
                        </Td>
                        <Td wide>
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
                              style={{ backgroundColor: `${unitColor(p.unit)}18` }}
                            >
                              <UnitIcon unit={p.unit} size={14} />
                            </div>
                            <span className="text-[13px] font-semibold text-foreground">{p.name}</span>
                          </div>
                        </Td>
                        <Td>
                          <span className="text-[12px] text-sub">{p.unit}</span>
                        </Td>
                        <Td>
                          <input
                            inputMode="decimal"
                            value={entries[p.id]?.cost || ''}
                            onChange={(e) => updateEntry(p.id, 'cost', e.target.value)}
                            className="w-[64px] rounded-lg bg-bg px-2 py-1.5 text-[13px] font-semibold text-foreground outline-none"
                          />
                        </Td>
                        <Td>
                          <span className="text-[13px] font-semibold text-foreground">
                            {currency} {p.sell_price}
                          </span>
                        </Td>
                        <Td>
                          <input
                            inputMode="decimal"
                            placeholder="0"
                            value={entries[p.id]?.qty || ''}
                            onChange={(e) => updateEntry(p.id, 'qty', e.target.value)}
                            className="w-[60px] rounded-lg px-2 py-1.5 text-[13px] font-bold outline-none"
                            style={{ backgroundColor: colors.stockLight, color: colors.stock }}
                          />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-sub">Sell price is shown for reference only — edit it from Items.</p>
          </div>
          <div className="px-4 pb-8 pt-2">
            <PressableButton
              onClick={handleSubmit}
              loading={submitting}
              className="w-full rounded-2xl py-[17px] text-base font-bold text-white"
              style={{ backgroundColor: colors.stock }}
            >
              {online ? t.updateStock : `${t.updateStock} (offline — will sync later)`}
            </PressableButton>
            {queuedCount > 0 && (
              <p className="mt-2 text-center text-xs text-sub">
                {queuedCount} stock-in entr{queuedCount === 1 ? 'y' : 'ies'} saved offline, waiting to sync
              </p>
            )}
            <button onClick={() => setStep(1)} className="mt-1 w-full py-3 text-sm text-sub">
              ← {t.cancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Th({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <th
      className={`py-2.5 text-[10px] font-bold uppercase tracking-wide text-sub ${wide ? 'pl-3' : 'px-2'}`}
      style={wide ? { paddingRight: 8 } : undefined}
    >
      {children}
    </th>
  );
}

function Td({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <td className={`py-2 align-middle ${wide ? 'pl-3 pr-2' : 'px-2'}`}>{children}</td>;
}