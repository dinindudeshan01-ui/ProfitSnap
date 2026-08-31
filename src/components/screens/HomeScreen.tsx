'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Boxes, BarChart3, ShoppingBag, Wallet, Settings, HandCoins } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getSetting } from '@/lib/db/queries';
import { useLang } from '@/lib/i18n/LangContext';
import { todayStr, SaleWithProduct } from '@/lib/types';
import { colors } from '@/lib/theme';
import { SCAN_BASE_CHARGE } from '@/lib/credits/format';

interface Stats {
  items: number;
  salesToday: number;
  profitToday: number;
}

function fmt(n: number) {
  if (Math.abs(n) >= 100000) return (n / 100000).toFixed(1) + 'L';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n).toString();
}

function ActionButton({
  label,
  sub,
  color,
  lightColor,
  Icon,
  onClick,
}: {
  label: string;
  sub: string;
  color: string;
  lightColor: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[130px] w-[calc(50%-7px)] flex-col justify-between rounded-[20px] border-t-4 bg-white p-4 pt-[22px] text-left shadow-sm active:opacity-85"
      style={{ borderTopColor: color }}
    >
      <div
        className="mb-2.5 flex h-[46px] w-[46px] items-center justify-center rounded-2xl"
        style={{ backgroundColor: lightColor }}
      >
        <Icon size={22} color={color} />
      </div>
      <div>
        <div className="text-sm font-bold leading-tight text-foreground">{label}</div>
        <div className="mt-0.5 text-[11px] leading-tight text-sub">{sub}</div>
      </div>
    </button>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useLang();
  const [stats, setStats] = useState<Stats>({ items: 0, salesToday: 0, profitToday: 0 });
  const [salesLog, setSalesLog] = useState<SaleWithProduct[]>([]);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [shopNo, setShopNo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const supabase = createClient();

      // Mirrors RootNavigator.js: redirect to setup if it hasn't run yet.
      const setupComplete = await getSetting(supabase, 'setupComplete');
      if (setupComplete !== 'true') {
        router.replace('/setup');
        return;
      }

      const today = todayStr();

      const [{ count: itemCount }, { data: todaySales }] = await Promise.all([
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase
          .from('sales')
          .select('*, products(name, unit)')
          .eq('date', today)
          .order('id', { ascending: false }),
      ]);

      const sales: SaleWithProduct[] = (todaySales ?? []).map((s: any) => ({
        ...s,
        pname: s.products?.name ?? '',
        punit: s.products?.unit ?? '',
      }));

      const totalProfit = sales.reduce(
        (sum, s) => sum + (s.qty * s.sell_price - s.qty * s.avg_cost),
        0
      );

      setStats({ items: itemCount ?? 0, salesToday: sales.length, profitToday: totalProfit });
      setSalesLog(sales);
    } catch (err) {
      console.error('HomeScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not connect to the database');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Fires independently of load() below — this is the one thing on Home
    // that should show up even if everything else (items, sales, credits)
    // fails, so support can ask "what's your shop ID" regardless of what's
    // broken.
    fetch('/api/tenant/shop-id')
      .then((r) => r.json())
      .then((d) => setShopNo(d.shopNo ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();

    // Independent fetch — a credits-API hiccup should never block the rest
    // of the Home screen from rendering, so this fails silently and just
    // leaves the pill blank rather than throwing into the main error state.
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setCreditBalance(data.balance);
      })
      .catch(() => {});
  }, [load]);

  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        {shopNo !== null && (
          <p className="mb-3 text-xs font-semibold text-sub">
            Shop ID: <span className="text-foreground">#{shopNo}</span> — have this ready if you contact support
          </p>
        )}
        <h2 className="mb-2 text-lg font-bold text-foreground">Can&apos;t reach the database</h2>
        <p className="mb-1 text-sm text-sub">{error}</p>
        <p className="mb-5 text-xs text-sub">
          Check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local point to a
          real Supabase project, and that supabase/schema.sql has been run.
        </p>
        <button
          onClick={load}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: colors.home }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-foreground">
            Profit<span style={{ color: colors.home }}>Snap</span>
          </h1>
          <p className="mt-0.5 text-xs text-sub">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {shopNo !== null && <span className="ml-1.5 text-sub/70">· Shop #{shopNo}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/credits')}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2.5"
            style={{
              backgroundColor:
                creditBalance !== null && creditBalance < SCAN_BASE_CHARGE ? '#FEE2E2' : colors.creditsLight,
            }}
          >
            <Wallet
              size={15}
              color={creditBalance !== null && creditBalance < SCAN_BASE_CHARGE ? colors.danger : colors.credits}
            />
            <span
              className="text-[13px] font-semibold"
              style={{
                color: creditBalance !== null && creditBalance < SCAN_BASE_CHARGE ? colors.danger : colors.credits,
              }}
            >
              {creditBalance === null ? '—' : creditBalance} credits
            </span>
          </button>
          <button
            onClick={() => router.push('/settings')}
            aria-label="Settings"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl"
            style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
          >
            <Settings size={17} color={colors.sub} />
          </button>
        </div>
      </div>

      <div className="flex gap-2.5 px-4 pt-3">
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: colors.products }}>
            {loading ? '—' : stats.items}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-sub">{t.navItems}</div>
        </div>
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: colors.sales }}>
            {loading ? '—' : stats.salesToday}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-sub">{t.salesToday}</div>
        </div>
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <div className="text-[17px] font-extrabold tracking-tight" style={{ color: colors.profit }}>
            {loading ? '—' : fmt(stats.profitToday)}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-sub">{t.todayProfit}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3.5 px-4 pt-4">
        <ActionButton
          label={t.recordSales}
          sub={t.recordSalesSub}
          color={colors.sales}
          lightColor={colors.salesLight}
          Icon={ShoppingCart}
          onClick={() => router.push('/sales')}
        />
        <ActionButton
          label={t.stockIn}
          sub={t.stockInSub}
          color={colors.stock}
          lightColor={colors.stockLight}
          Icon={Boxes}
          onClick={() => router.push('/stock')}
        />
        <ActionButton
          label={t.myProfit}
          sub={t.myProfitSub}
          color={colors.profit}
          lightColor={colors.profitLight}
          Icon={BarChart3}
          onClick={() => router.push('/profit')}
        />
        <ActionButton
          label={t.myItems}
          sub={t.myItemsSub}
          color={colors.products}
          lightColor={colors.productsLight}
          Icon={ShoppingBag}
          onClick={() => router.push('/items')}
        />
        <ActionButton
          label={t.creditSale}
          sub={t.creditSaleSub}
          color={colors.creditSale}
          lightColor={colors.creditSaleLight}
          Icon={HandCoins}
          onClick={() => router.push('/credit-sales')}
        />
      </div>

      <div className="flex-1 px-4 pt-[18px]">
        <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sub">{t.todayLog}</h2>
        {salesLog.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-[13px] text-sub">{t.noSalesYet}</p>
          </div>
        ) : (
          <div className="space-y-2 pb-6">
            {salesLog.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl bg-white p-3.5 shadow-sm"
              >
                <div>
                  <div className="text-sm font-semibold text-foreground">{s.pname}</div>
                  <div className="mt-0.5 text-[11px] text-sub">
                    {s.qty} {s.punit}
                  </div>
                </div>
                <div className="text-sm font-bold" style={{ color: colors.sales }}>
                  +{(s.qty * s.sell_price).toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
