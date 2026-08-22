'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAllSales } from '@/lib/db/queries';
import { todayStr, Sale } from '@/lib/types';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import ArcHeader from '@/components/ArcHeader';
import DataLoadError from '@/components/DataLoadError';
import { colors } from '@/lib/theme';
import { downloadCsv } from '@/lib/csvExport';

export default function SalesHistoryScreen() {
  const router = useRouter();
  const { currency } = useCurrency();
  const supabase = createClient();

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSales(await getAllSales(supabase));
    } catch (err) {
      console.error('SalesHistoryScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load sales history');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.sales} />;
  }

  function exportCsv() {
    downloadCsv(
      `sales-history-${todayStr()}.csv`,
      ['Date', 'Product ID', 'Qty', 'Sell price', 'Cost', 'Revenue', 'Profit'],
      sales.map((s) => [
        s.date,
        s.pid,
        s.qty,
        s.sell_price,
        s.avg_cost,
        (s.qty * s.sell_price).toFixed(2),
        (s.qty * (s.sell_price - s.avg_cost)).toFixed(2),
      ])
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Sales history" subtitle={`${sales.length} sales recorded`} color={colors.sales} onBack={() => router.push('/sales')} />

      <div className="flex-1 px-4 pt-4 pb-24">
        <div className="mb-3 flex justify-end">
          <button
            onClick={exportCsv}
            disabled={sales.length === 0}
            title="Export to CSV"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm disabled:opacity-40"
          >
            <Download size={16} color={colors.sales} />
          </button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-sub">Loading…</p>
        ) : sales.length === 0 ? (
          <p className="py-14 text-center text-sm text-sub">No sales recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {sales.map((s) => {
              const profit = s.qty * (s.sell_price - s.avg_cost);
              return (
                <div key={s.id} className="rounded-xl bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {s.qty} × {currency} {s.sell_price}
                      </p>
                      <p className="text-[11px] text-sub">{s.date}</p>
                    </div>
                    <p className="text-sm font-bold" style={{ color: colors.profit }}>
                      +{currency} {profit.toFixed(0)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
