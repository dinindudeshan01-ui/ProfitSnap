'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getAllProducts, getAllSales } from '@/lib/db/queries';
import { todayStr, Product, Sale } from '@/lib/types';
import { useLang } from '@/lib/i18n/LangContext';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import ArcHeader from '@/components/ArcHeader';
import DataLoadError from '@/components/DataLoadError';
import { colors } from '@/lib/theme';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/csvExport';

type Period = 'today' | 'week' | 'month' | 'all';

const PERIODS: { key: Period; labelKey: string }[] = [
  { key: 'today', labelKey: 'today' },
  { key: 'week', labelKey: 'thisWeek' },
  { key: 'month', labelKey: 'thisMonth' },
  { key: 'all', labelKey: 'allTime' },
];

function fmtF(n: number, currency: string) {
  return currency + ' ' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function ProfitScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { currency } = useCurrency();
  const supabase = createClient();

  const [period, setPeriod] = useState<Period>('today');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, s] = await Promise.all([getAllProducts(supabase), getAllSales(supabase)]);
      setProducts(p);
      setSales(s);
    } catch (err) {
      console.error('ProfitScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load profit data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.profit} />;
  }

  const today = todayStr();
  const now = new Date();
  let filtered = sales;
  // Same window one period back, for the "vs last period" comparison
  // below — 'all' has no meaningful previous period, so it's left out.
  let previousFiltered: Sale[] = [];
  if (period === 'today') {
    filtered = sales.filter((s) => s.date === today);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    previousFiltered = sales.filter((s) => s.date === yesterdayStr);
  } else if (period === 'week') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    filtered = sales.filter((s) => new Date(s.date) >= weekAgo);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    previousFiltered = sales.filter((s) => new Date(s.date) >= twoWeeksAgo && new Date(s.date) < weekAgo);
  } else if (period === 'month') {
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    filtered = sales.filter((s) => s.date.startsWith(monthStr));
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
    previousFiltered = sales.filter((s) => s.date.startsWith(prevMonthStr));
  }

  function profitOf(rows: Sale[]) {
    let rev = 0;
    let cost = 0;
    for (const s of rows) {
      const p = products.find((x) => x.id === s.pid);
      if (!p) continue;
      rev += s.qty * s.sell_price;
      cost += s.qty * s.avg_cost;
    }
    return rev - cost;
  }
  const previousProfit = period === 'all' ? null : profitOf(previousFiltered);

  // Last-14-days daily profit, for the trend chart below — computed once
  // from the full `sales` list regardless of the selected period filter,
  // since the chart's whole point is showing the shape over time rather
  // than a single period's total.
  const dailySeries: { date: string; profit: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayRows = sales.filter((s) => s.date === dateStr);
    dailySeries.push({ date: dateStr, profit: profitOf(dayRows) });
  }
  const maxAbsProfit = Math.max(1, ...dailySeries.map((d) => Math.abs(d.profit)));

  let totalRev = 0;
  let totalCost = 0;
  const byProduct: Record<number, { name: string; unit: string; qty: number; revenue: number; cost: number }> = {};
  filtered.forEach((s) => {
    const p = products.find((x) => x.id === s.pid);
    if (!p) return;
    const rev = s.qty * s.sell_price;
    const cost = s.qty * s.avg_cost;
    totalRev += rev;
    totalCost += cost;
    if (!byProduct[s.pid]) byProduct[s.pid] = { name: p.name, unit: p.unit, qty: 0, revenue: 0, cost: 0 };
    byProduct[s.pid].qty += s.qty;
    byProduct[s.pid].revenue += rev;
    byProduct[s.pid].cost += cost;
  });
  const totalProfit = totalRev - totalCost;
  const margin = totalRev > 0 ? ((totalProfit / totalRev) * 100).toFixed(1) : '0';
  const breakdown = Object.values(byProduct).sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost));

  function exportCsv() {
    downloadCsv(
      `profit-${period}-${todayStr()}.csv`,
      ['Item', 'Unit', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin %'],
      breakdown.map((item) => {
        const profit = item.revenue - item.cost;
        const m = item.revenue > 0 ? Math.round((profit / item.revenue) * 100) : 0;
        return [item.name, item.unit, item.qty, item.revenue.toFixed(2), item.cost.toFixed(2), profit.toFixed(2), m];
      })
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title={t.myProfit} subtitle={t.myProfitSub} color={colors.profit} onBack={() => router.push('/')} />

      <div className="flex-1 px-4 pb-24 pt-4">
        <div className="mb-3.5 flex gap-2">
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className="rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-sm"
                style={{
                  backgroundColor: active ? colors.profit : 'white',
                  color: active ? 'white' : colors.sub,
                }}
              >
                {t[p.labelKey]}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center py-5">
          <div className="text-[13px] font-semibold text-sub">{t.netProfit}</div>
          <div className="mt-1 text-[40px] font-extrabold tracking-tight" style={{ color: colors.profit }}>
            {loading ? '—' : fmtF(totalProfit, currency)}
          </div>
          <div className="mt-1.5 text-xs text-sub">
            {margin}% {t.margin}
          </div>
          {!loading && previousProfit !== null && (
            <div
              className="mt-1 text-[11px] font-semibold"
              style={{ color: totalProfit >= previousProfit ? colors.sales : colors.danger }}
            >
              {(() => {
                if (previousProfit === 0) {
                  return totalProfit === 0 ? 'No change vs last period' : totalProfit > 0 ? 'Up vs last period (was 0)' : '';
                }
                const pct = Math.round(((totalProfit - previousProfit) / Math.abs(previousProfit)) * 100);
                return `${pct >= 0 ? '+' : ''}${pct}% vs last period`;
              })()}
            </div>
          )}
        </div>

        <div className="mb-3 flex gap-2.5">
          <div className="flex-1 rounded-xl bg-white p-3.5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-sub">{t.revenueLabel}</div>
            <div className="mt-0.5 text-xl font-extrabold tracking-tight" style={{ color: colors.sales }}>
              {fmtF(totalRev, currency)}
            </div>
          </div>
          <div className="flex-1 rounded-xl bg-white p-3.5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-sub">{t.costLabel}</div>
            <div className="mt-0.5 text-xl font-extrabold tracking-tight text-sub">{fmtF(totalCost, currency)}</div>
          </div>
        </div>

        {/* Last-14-days trend — a simple dependency-free SVG bar chart.
            Loss days (profit < 0) render below the baseline in red so a
            bad week is visible at a glance, not just inferable from
            numbers. */}
        <div className="mb-3 rounded-xl bg-white p-3.5 shadow-sm">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-sub">Last 14 days</div>
          <svg viewBox="0 0 280 70" className="w-full" style={{ height: 70 }}>
            <line x1={0} y1={35} x2={280} y2={35} stroke="var(--border)" strokeWidth={1} />
            {dailySeries.map((d, i) => {
              const barWidth = 14;
              const gap = 6;
              const x = i * (barWidth + gap) + 4;
              const barHeight = Math.max(1, (Math.abs(d.profit) / maxAbsProfit) * 30);
              const y = d.profit >= 0 ? 35 - barHeight : 35;
              const isToday = i === dailySeries.length - 1;
              return (
                <rect
                  key={d.date}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={d.profit >= 0 ? colors.profit : colors.danger}
                  opacity={isToday ? 1 : 0.55}
                >
                  <title>
                    {d.date}: {fmtF(d.profit, currency)}
                  </title>
                </rect>
              );
            })}
          </svg>
        </div>

        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-sub">{t.itemBreakdown}</h2>
          <button
            onClick={exportCsv}
            disabled={breakdown.length === 0}
            title="Export to CSV"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm disabled:opacity-40"
          >
            <Download size={15} color={colors.profit} />
          </button>
        </div>
        <div className="rounded-[20px] bg-white p-5 shadow-sm">
          {breakdown.length === 0 ? (
            <div className="py-2.5 text-center">
              <p className="text-[13px] text-sub">{t.noSalesYet}</p>
            </div>
          ) : (
            breakdown.map((item, idx) => {
              const profit = item.revenue - item.cost;
              const m = item.revenue > 0 ? Math.round((profit / item.revenue) * 100) : 0;
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between py-3"
                  style={{ borderBottom: idx === breakdown.length - 1 ? 'none' : `1px solid ${colors.border}` }}
                >
                  <div>
                    <div className="text-sm font-semibold text-foreground">{item.name}</div>
                    <div className="mt-0.5 text-xs text-sub">
                      {item.qty % 1 === 0 ? item.qty : item.qty.toFixed(2)} {item.unit} · {fmtF(item.revenue, currency)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ color: colors.profit }}>
                      {fmtF(profit, currency)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-sub">
                      {m}% {t.margin_label}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}