'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAllStockIn } from '@/lib/db/queries';
import { todayStr, StockIn } from '@/lib/types';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import ArcHeader from '@/components/ArcHeader';
import DataLoadError from '@/components/DataLoadError';
import { colors } from '@/lib/theme';
import { downloadCsv } from '@/lib/csvExport';

type StockInRow = StockIn & { pname: string; punit: string };

export default function StockHistoryScreen() {
  const router = useRouter();
  const { currency } = useCurrency();
  const supabase = createClient();

  const [rows, setRows] = useState<StockInRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await getAllStockIn(supabase));
    } catch (err) {
      console.error('StockHistoryScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load stock-in history');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.stock} />;
  }

  function exportCsv() {
    downloadCsv(
      `stock-in-history-${todayStr()}.csv`,
      ['Date', 'Item', 'Unit', 'Qty added', 'Cost'],
      rows.map((r) => [r.date, r.pname, r.punit, r.qty, r.cost])
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Stock-in history" subtitle={`${rows.length} entries`} color={colors.stock} onBack={() => router.push('/stock')} />

      <div className="flex-1 px-4 pt-4 pb-24">
        <div className="mb-3 flex justify-end">
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            title="Export to CSV"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm disabled:opacity-40"
          >
            <Download size={16} color={colors.stock} />
          </button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-sub">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-sub">No stock-in entries yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{r.pname || `Product #${r.pid}`}</p>
                    <p className="text-[11px] text-sub">
                      {r.date} · +{r.qty} {r.punit}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-foreground">
                    {currency} {r.cost}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
