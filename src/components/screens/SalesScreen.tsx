'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Camera, Minus, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAllProducts, addSale, deductStock, reverseSale } from '@/lib/db/queries';
import { todayStr, Product } from '@/lib/types';
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

export default function SalesScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { currency } = useCurrency();
  const showToast = useToast();
  const supabase = createClient();
  const online = useOnline();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Holds the sale ids from the batch that was just submitted, so "Undo
  // last sale" can reverse them. Cleared on navigating away or once the
  // person confirms they're done — this is a short-lived "oops" catch,
  // not a full sales-history/edit feature.
  const [lastBatch, setLastBatch] = useState<{ saleIds: number[]; itemCount: number } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getAllProducts(supabase);
      setProducts(rows);
    } catch (err) {
      console.error('SalesScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load products');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    setCart({});
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.sales} />;
  }

  const filtered = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;

  function adjQty(pid: number, delta: number, maxStock: number) {
    setLastBatch(null);
    setCart((c) => {
      const current = c[pid] || 0;
      const next = Math.max(0, Math.min(maxStock, current + delta));
      return { ...c, [pid]: next };
    });
  }

  function setQty(pid: number, text: string, maxStock: number) {
    setLastBatch(null);
    const n = parseFloat(text) || 0;
    setCart((c) => ({ ...c, [pid]: Math.max(0, Math.min(maxStock, n)) }));
  }

  const cartEntries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const totalRevenue = cartEntries.reduce((sum, [pid, qty]) => {
    const p = products.find((x) => x.id === Number(pid));
    return sum + (p ? qty * p.sell_price : 0);
  }, 0);
  const totalProfit = cartEntries.reduce((sum, [pid, qty]) => {
    const p = products.find((x) => x.id === Number(pid));
    return sum + (p ? qty * (p.sell_price - p.avg_cost) : 0);
  }, 0);

  const [queuedCount, setQueuedCount] = useState(0);

  const refreshQueuedCount = useCallback(async () => {
    const queued = await getQueuedActions('sale');
    setQueuedCount(queued.length);
  }, []);

  useEffect(() => {
    refreshQueuedCount();
  }, [refreshQueuedCount]);

  // Replays one queued sale exactly the same way handleSubmit does it
  // live — same two writes (insert the sale row, deduct stock), so a
  // sale recorded while offline behaves identically once it actually
  // syncs, not as some separate simplified path.
  const processSaleItem = useCallback(
    async (payload: unknown) => {
      const item = payload as { pid: number; qty: number; sell_price: number; avg_cost: number; date: string };
      await addSale(supabase, item);
      await deductStock(supabase, item.pid, item.qty);
    },
    [supabase]
  );

  const syncQueue = useCallback(async () => {
    const { succeeded } = await flushQueue('sale', processSaleItem);
    if (succeeded > 0) {
      showToast(`Synced ${succeeded} queued sale${succeeded === 1 ? '' : 's'} from earlier`);
      load();
    }
    refreshQueuedCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processSaleItem]);

  // Fires the moment connectivity comes back — this is what makes
  // queueing actually feel automatic instead of requiring the person to
  // remember to come back and resubmit.
  useEffect(() => {
    if (online) syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function handleSubmit() {
    if (!online) {
      // Queue every cart line as its own action (same shape processSaleItem
      // expects) instead of failing outright — the sale is recorded the
      // moment connectivity returns, without the person needing to redo
      // anything or even remember they were offline.
      const today = todayStr();
      for (const [pidStr, qty] of cartEntries) {
        const p = products.find((x) => x.id === Number(pidStr));
        if (!p) continue;
        await enqueueAction('sale', { pid: p.id, qty, sell_price: p.sell_price, avg_cost: p.avg_cost, date: today });
      }
      setCart({});
      await refreshQueuedCount();
      showToast(`You're offline — ${cartEntries.length} sale${cartEntries.length === 1 ? '' : 's'} saved and will sync automatically`);
      return;
    }
    setSubmitting(true);
    const today = todayStr();
    const succeeded: number[] = [];
    const saleIds: number[] = [];
    try {
      for (const [pidStr, qty] of cartEntries) {
        const p = products.find((x) => x.id === Number(pidStr));
        if (!p) continue;
        const saleId = await addSale(supabase, { pid: p.id, qty, sell_price: p.sell_price, avg_cost: p.avg_cost, date: today });
        await deductStock(supabase, p.id, qty);
        saleIds.push(saleId);
        succeeded.push(p.id);
      }
      setCart({});
      setLastBatch({ saleIds, itemCount: succeeded.length });
      // Deliberately not navigating away here — the "Undo last sale"
      // confirmation below needs to stay visible for a moment in case
      // the person immediately realizes they made a mistake. They leave
      // via the "Done" button, which navigates then.
    } catch (err) {
      // Partial failure: whatever's in `succeeded` already hit the
      // database and can't be silently retried without double-counting,
      // so drop only those from the cart and leave the rest for the user
      // to review and resubmit. Never navigate away on a failure — they
      // need to see this screen to know what's still outstanding.
      setCart((c) => {
        const next = { ...c };
        for (const pid of succeeded) delete next[pid];
        return next;
      });
      const remaining = cartEntries.length - succeeded.length;
      showToast(
        succeeded.length > 0
          ? `Saved ${succeeded.length} of ${cartEntries.length} — ${remaining} failed, please try again`
          : err instanceof Error
          ? err.message
          : 'Could not record sales — please try again'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function undoLastBatch() {
    if (!lastBatch) return;
    setUndoing(true);
    try {
      for (const id of lastBatch.saleIds) {
        await reverseSale(supabase, id);
      }
      showToast('Sale undone — stock restored');
      setLastBatch(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not undo — please check Items manually');
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader
        title={t.recordSales}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        color={colors.sales}
        onBack={() => router.push('/')}
      />

      <div className="px-4 pt-3">
        <button onClick={() => router.push('/sales/history')} className="text-xs font-semibold" style={{ color: colors.sales }}>
          View sales history →
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
              style={{ backgroundColor: colors.sales }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 px-4 pt-4">
        <div className="mb-3 flex h-12 items-center gap-2.5 rounded-xl bg-white px-3.5 shadow-sm">
          <Search size={18} color={colors.sub} />
          <input
            className="flex-1 bg-transparent text-[15px] text-foreground outline-none"
            placeholder={t.searchItem}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          onClick={() => router.push('/scan?type=sales')}
          className="mb-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 shadow-sm active:opacity-85"
        >
          <Camera size={18} color={colors.sales} />
          <span className="text-[13px] font-semibold" style={{ color: colors.sales }}>
            Snap today&apos;s sales sheet instead
          </span>
        </button>

        <div className="space-y-2" style={{ paddingBottom: cartEntries.length > 0 ? 160 : 40 }}>
          {loading ? (
            <p className="py-10 text-center text-sm text-sub">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-14">
              <p className="text-center text-sm text-sub">{t.noProductsYet}</p>
            </div>
          ) : (
            filtered.map((p) => {
              const qty = cart[p.id] || 0;
              return (
                <div key={p.id} className="flex items-center gap-2.5 rounded-xl bg-white px-3.5 py-3 shadow-sm">
                  <div
                    className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px]"
                    style={{ backgroundColor: `${unitColor(p.unit)}18` }}
                  >
                    <UnitIcon unit={p.unit} size={18} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-foreground">{p.name}</div>
                    <div className="mt-0.5 text-[11px] text-sub">
                      {currency} {p.sell_price} / {p.unit} · {t.currentStock}: {p.stock}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => adjQty(p.id, -1, p.stock)}
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px]"
                      style={{ backgroundColor: colors.salesLight }}
                    >
                      <Minus size={16} color={colors.sales} />
                    </button>
                    <input
                      className="w-[34px] bg-transparent text-center text-base font-bold text-foreground outline-none"
                      value={qty}
                      onChange={(e) => setQty(p.id, e.target.value, p.stock)}
                      inputMode="decimal"
                    />
                    <button
                      onClick={() => adjQty(p.id, 1, p.stock)}
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px]"
                      style={{ backgroundColor: colors.salesLight }}
                    >
                      <Plus size={16} color={colors.sales} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {cartEntries.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-10 mx-auto max-w-md px-4">
          <div className="rounded-[20px] bg-white p-4 shadow-lg">
            <div className="mb-3 flex justify-between">
              <div>
                <div className="text-xs text-sub">{t.revenue}</div>
                <div className="mt-0.5 text-xl font-extrabold tracking-tight" style={{ color: colors.sales }}>
                  {totalRevenue.toFixed(0)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-sub">{t.grossProfit}</div>
                <div className="mt-0.5 text-xl font-extrabold tracking-tight" style={{ color: colors.profit }}>
                  {totalProfit.toFixed(0)}
                </div>
              </div>
            </div>
            <PressableButton
              onClick={handleSubmit}
              loading={submitting}
              className="w-full rounded-2xl py-4 text-base font-bold text-white"
              style={{ backgroundColor: colors.sales }}
            >
              {online ? t.submitSales : `${t.submitSales} (offline — will sync later)`}
            </PressableButton>
            {queuedCount > 0 && (
              <p className="mt-2 text-center text-xs text-sub">
                {queuedCount} sale{queuedCount === 1 ? '' : 's'} saved offline, waiting to sync
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
