'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Phone, ChevronDown, ChevronUp, Send, CheckCircle2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n/LangContext';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import { useToast } from '@/components/Toast';
import ArcHeader from '@/components/ArcHeader';
import DataLoadError from '@/components/DataLoadError';
import PressableButton from '@/components/PressableButton';
import BottomSheet from '@/components/BottomSheet';
import ItemPicker from '@/components/ItemPicker';
import { colors } from '@/lib/theme';
import { todayStr, Product } from '@/lib/types';

interface CreditSaleRow {
  id: number;
  description: string | null;
  amount: number;
  amount_settled: number;
  status: 'open' | 'partially_settled' | 'settled';
  due_date: string | null;
  date: string;
}

interface CustomerGroup {
  id: number;
  name: string;
  phone: string | null;
  sales: CreditSaleRow[];
  totalOwed: number;
}

export default function CreditSalesScreen() {
  const router = useRouter();
  const { t } = useLang();
  const { currency } = useCurrency();
  const showToast = useToast();
  const supabase = createClient();

  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Manual-entry sheet — same fields as the scan flow's credit_sale row, but
  // typed directly instead of coming from OCR. Useful when there's no
  // handwritten sheet to photograph at all (a single quick verbal sale).
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualProduct, setManualProduct] = useState<Product | null>(null);
  const [manualQty, setManualQty] = useState('1');
  const [manualAmount, setManualAmount] = useState('');
  const [manualSaving, setManualSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: customers, error: custErr } = await supabase
        .from('customers')
        .select('id, name, phone');
      if (custErr) throw custErr;

      const { data: sales, error: salesErr } = await supabase
        .from('credit_sales')
        .select('id, customer_id, description, amount, amount_settled, status, due_date, date')
        .neq('status', 'settled')
        .order('date', { ascending: false });
      if (salesErr) throw salesErr;

      const byCustomer = new Map<number, CustomerGroup>();
      for (const c of customers ?? []) {
        byCustomer.set(c.id, { id: c.id, name: c.name, phone: c.phone, sales: [], totalOwed: 0 });
      }
      for (const s of sales ?? []) {
        const g = byCustomer.get(s.customer_id);
        if (!g) continue;
        const owed = Number(s.amount) - Number(s.amount_settled);
        g.sales.push({ ...s, amount: Number(s.amount), amount_settled: Number(s.amount_settled) });
        g.totalOwed += owed;
      }
      const list = Array.from(byCustomer.values())
        .filter((g) => g.sales.length > 0)
        .sort((a, b) => b.totalOwed - a.totalOwed);
      setGroups(list);
    } catch (err) {
      console.error('CreditSalesScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load credit sales');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function markSettled(saleId: number, customerId: number) {
    setBusyId(saleId);
    try {
      const group = groups.find((g) => g.id === customerId);
      const sale = group?.sales.find((s) => s.id === saleId);
      const { error: updErr } = await supabase
        .from('credit_sales')
        .update({ status: 'settled', amount_settled: sale ? sale.amount : undefined })
        .eq('id', saleId);
      if (updErr) throw updErr;
      showToast(t.settled || 'Settled');
      load();
    } catch (err) {
      console.error('markSettled failed:', err);
      showToast(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setBusyId(null);
    }
  }

  async function sendReminder(group: CustomerGroup) {
    if (!group.phone) {
      showToast(t.customerPhone + ' —' + ' missing');
      return;
    }
    setBusyId(group.id);
    try {
      const message = `Hi ${group.name}, a friendly reminder that you have ${currency} ${group.totalOwed.toFixed(
        0
      )} outstanding with us. Thank you!`;
      const res = await fetch('/api/reminders/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: group.id, message }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to send');
      showToast(t.reminderSent || 'Reminder sent');
    } catch (err) {
      showToast((t.reminderFailed || 'Could not send reminder') + ': ' + (err instanceof Error ? err.message : ''));
    } finally {
      setBusyId(null);
    }
  }

  function openManual() {
    setManualName('');
    setManualPhone('');
    setManualDescription('');
    setManualProduct(null);
    setManualQty('1');
    setManualAmount('');
    setManualOpen(true);
  }

  async function saveManual() {
    const name = manualName.trim();
    const amount = parseFloat(manualAmount) || 0;
    if (!name || amount <= 0) {
      showToast(`${t.customerName} & ${t.amountOwed} required`);
      return;
    }
    setManualSaving(true);
    try {
      const phone = manualPhone.trim() || null;

      // Same dedup-by-phone logic as the scan flow — reuse the existing
      // customer row rather than forking a new one for the same person.
      let customerId: number | null = null;
      if (phone) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();
        if (existing) customerId = existing.id;
      }
      if (!customerId) {
        const { data: created, error: custErr } = await supabase
          .from('customers')
          .insert({ name, phone })
          .select('id')
          .single();
        if (custErr) throw custErr;
        customerId = created.id;
      }

      // Only decrement stock when this credit sale is actually linked to a
      // catalog product — a free-text note ("groceries") has nothing to
      // decrement. Same clamp-at-zero behavior as a normal sale, so an
      // over-sold item doesn't go negative in the stock count.
      const qty = manualProduct ? parseFloat(manualQty) || 0 : null;

      const { error: creditErr } = await supabase.from('credit_sales').insert({
        customer_id: customerId,
        pid: manualProduct?.id ?? null,
        description: manualDescription.trim() || null,
        amount,
        qty,
        date: todayStr(),
      });
      if (creditErr) throw creditErr;

      if (manualProduct && qty && qty > 0) {
        const newStock = Math.max(0, manualProduct.stock - qty);
        const { error: stockErr } = await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', manualProduct.id);
        if (stockErr) throw stockErr;
      }

      showToast(t.saveCreditSale || 'Saved');
      setManualOpen(false);
      load();
    } catch (err) {
      console.error('saveManual failed:', err);
      showToast(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setManualSaving(false);
    }
  }

  const grandTotal = groups.reduce((sum, g) => sum + g.totalOwed, 0);

  if (error) {
    return <DataLoadError message={error} onRetry={load} />;
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader
        title={t.screenCredit || 'Credit Sales'}
        subtitle={t.screenCreditSub || 'Track who owes you'}
        color={colors.creditSale}
        onBack={() => router.push('/')}
      />

      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-sub">{t.totalOwed || 'Total Owed'}</div>
          <div className="mt-1 text-2xl font-extrabold" style={{ color: colors.creditSale }}>
            {loading ? '—' : `${currency} ${grandTotal.toFixed(0)}`}
          </div>
        </div>
      </div>

      <div className="flex gap-2.5 px-4 pt-3">
        <PressableButton
          onClick={() => router.push('/scan?type=credit_sale')}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white"
          style={{ backgroundColor: colors.creditSale }}
        >
          <Camera size={18} color="white" />
          {t.creditSale || 'Credit Sale'}
        </PressableButton>
        <PressableButton
          onClick={openManual}
          aria-label="Add manually"
          className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold"
          style={{ backgroundColor: colors.creditSaleLight, color: colors.creditSale }}
        >
          <Plus size={18} color={colors.creditSale} />
        </PressableButton>
      </div>

      <div className="flex-1 px-4 pt-4">
        <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wide text-sub">
          {t.openDebts || 'Open Debts'}
        </h2>
        {loading ? (
          <p className="py-8 text-center text-[13px] text-sub">…</p>
        ) : groups.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <p className="text-[13px] text-sub">{t.noCreditSales || 'No credit sales yet'}</p>
          </div>
        ) : (
          <div className="space-y-2 pb-8">
            {groups.map((g) => {
              const isOpen = expanded.has(g.id);
              return (
                <div key={g.id} className="rounded-xl bg-white shadow-sm">
                  <button
                    onClick={() => toggle(g.id)}
                    className="flex w-full items-center justify-between p-3.5 text-left"
                  >
                    <div>
                      <div className="text-sm font-semibold text-foreground">{g.name}</div>
                      {g.phone && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-sub">
                          <Phone size={11} /> {g.phone}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold" style={{ color: colors.creditSale }}>
                        {currency} {g.totalOwed.toFixed(0)}
                      </div>
                      {isOpen ? <ChevronUp size={16} color={colors.sub} /> : <ChevronDown size={16} color={colors.sub} />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border px-3.5 pb-3.5 pt-2">
                      {g.sales.map((s) => {
                        const owed = s.amount - s.amount_settled;
                        return (
                          <div
                            key={s.id}
                            className="mb-2 flex items-center justify-between rounded-lg bg-bg px-3 py-2"
                          >
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                {s.description || '—'}
                              </div>
                              <div className="mt-0.5 text-[10px] text-sub">{s.date}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-xs font-bold text-foreground">
                                {currency} {owed.toFixed(0)}
                              </div>
                              <button
                                onClick={() => markSettled(s.id, g.id)}
                                disabled={busyId === s.id}
                                aria-label={t.markSettled || 'Mark as Settled'}
                                className="p-1 disabled:opacity-40"
                              >
                                <CheckCircle2 size={16} color={colors.products} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => sendReminder(g)}
                        disabled={busyId === g.id}
                        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: colors.creditSale }}
                      >
                        <Send size={13} color="white" />
                        {t.sendReminder || 'Send Reminder'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet visible={manualOpen} onClose={() => setManualOpen(false)}>
        <h2 className="mb-4 text-base font-bold text-foreground">{t.creditSale || 'Credit Sale'}</h2>

        <label className="mb-1.5 block text-[12px] font-semibold text-sub">{t.customerName}</label>
        <input
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder={t.customerName}
          className="mb-3.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-foreground outline-none"
        />

        <label className="mb-1.5 block text-[12px] font-semibold text-sub">{t.customerPhone}</label>
        <input
          value={manualPhone}
          onChange={(e) => setManualPhone(e.target.value)}
          placeholder="07XXXXXXXX"
          inputMode="tel"
          className="mb-3.5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-foreground outline-none"
        />

        <label className="mb-1.5 block text-[12px] font-semibold text-sub">Item / Note</label>
        <ItemPicker
          supabase={supabase}
          value={manualDescription}
          onChange={setManualDescription}
          selectedProduct={manualProduct}
          onSelectProduct={(p) => {
            setManualProduct(p);
            if (p) {
              setManualQty('1');
              setManualAmount(String(p.sell_price || ''));
            }
          }}
          accentColor={colors.creditSale}
        />

        {manualProduct && (
          <div className="mt-3.5">
            <label className="mb-1.5 block text-[12px] font-semibold text-sub">Qty</label>
            <input
              value={manualQty}
              onChange={(e) => {
                const q = e.target.value;
                setManualQty(q);
                const qtyNum = parseFloat(q) || 0;
                if (manualProduct) setManualAmount(String((qtyNum * manualProduct.sell_price).toFixed(2)));
              }}
              placeholder="1"
              inputMode="decimal"
              className="w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-foreground outline-none"
            />
          </div>
        )}

        <div className="mt-3.5">
          <label className="mb-1.5 block text-[12px] font-semibold text-sub">{t.amountOwed}</label>
          <input
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            placeholder="0"
            inputMode="decimal"
            className="mb-5 w-full rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-foreground outline-none"
          />
        </div>

        <PressableButton
          onClick={saveManual}
          loading={manualSaving}
          disabled={!manualName.trim() || !manualAmount}
          className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: colors.creditSale }}
        >
          {t.saveCreditSale || 'Save Credit Sale'}
        </PressableButton>
      </BottomSheet>
    </div>
  );
}
