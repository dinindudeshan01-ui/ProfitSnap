'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { setSetting, addProduct } from '@/lib/db/queries';
import { todayStr } from '@/lib/types';
import { useLang } from '@/lib/i18n/LangContext';
import FormField from '@/components/FormField';
import UnitPicker from '@/components/UnitPicker';
import { colors } from '@/lib/theme';

const CURRENCIES = [
  { value: 'Rs', label: 'Rs — Sri Lankan Rupee' },
  { value: '₹', label: '₹ — Indian Rupee' },
  { value: '$', label: '$ — US Dollar' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: '₩', label: '₩ — Korean Won' },
  { value: '€', label: '€ — Euro' },
  { value: '£', label: '£ — British Pound' },
];

interface ItemRow {
  name: string;
  unit: string;
  cost: string;
  sell: string;
  stock: string;
}

const EMPTY_ITEM: ItemRow = { name: '', unit: 'pcs', cost: '', sell: '', stock: '' };

export default function SetupScreen() {
  const router = useRouter();
  const { t } = useLang();
  const supabase = createClient();

  const [step, setStep] = useState<1 | 2>(1);
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [currency, setCurrency] = useState('Rs');
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  // Business name was already collected at signup — pre-fill it here so
  // the tenant is confirming/editing, not retyping from scratch. Owner
  // name genuinely is new (signup never asks for it).
  useEffect(() => {
    fetch('/api/tenant/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d.tenant?.business_name) setShopName(d.tenant.business_name);
      })
      .catch(() => {});
  }, []);

  function updateItem(idx: number, field: keyof ItemRow, value: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }
  function addItemRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  async function saveShopInfo() {
    // The real, canonical record for these two is tenants.business_name /
    // tenants.owner_name — that's what Admin Search and the rest of the
    // app read. Writing to `settings` too, unchanged, since some existing
    // code paths may still read shopName/ownerName from there and this
    // fix shouldn't silently break them — but the tenants row is what
    // actually matters now.
    await fetch('/api/tenant/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: shopName, owner_name: ownerName }),
    }).catch(() => {});
    await setSetting(supabase, 'shopName', shopName);
    await setSetting(supabase, 'ownerName', ownerName);
    await setSetting(supabase, 'currency', currency);
    await setSetting(supabase, 'setupComplete', 'true');
  }

  async function finish() {
    await saveShopInfo();
    for (const item of items) {
      if (!item.name.trim()) continue;
      await addProduct(supabase, {
        code: '',
        name: item.name.trim(),
        unit: item.unit,
        avg_cost: parseFloat(item.cost) || 0,
        sell_price: parseFloat(item.sell) || 0,
        stock: parseFloat(item.stock) || 0,
        created: todayStr(),
      });
    }
    router.push('/');
  }

  async function snapInstead() {
    await saveShopInfo();
    router.push('/scan?type=setup&onCompleteRedirect=/');
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pb-5 pt-7" style={{ backgroundColor: colors.home }}>
        <p className="mb-1 text-[13px] font-semibold text-white/75">{step === 1 ? t.step1 : t.step2}</p>
        <h1 className="text-[22px] font-extrabold tracking-tight text-white">
          {step === 1 ? t.setupTitle1 : t.setupTitle2}
        </h1>
      </div>
      <div className="flex gap-1.5 p-4">
        <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: step === 1 ? colors.home : colors.border }} />
        <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: step === 2 ? colors.home : colors.border }} />
      </div>

      {step === 1 ? (
        <>
          <div className="flex-1 px-4">
            <FormField label={t.shopName} value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="e.g. Ranjith Auto Parts" />
            <FormField label={t.ownerName} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Ranjith Kumar" />
            <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-sub">{t.currency}</label>
            <div className="mb-4 flex flex-wrap gap-2">
              {CURRENCIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCurrency(c.value)}
                  className="rounded-xl border-[1.5px] px-3.5 py-2.5"
                  style={{
                    backgroundColor: currency === c.value ? colors.homeLight : 'white',
                    borderColor: currency === c.value ? colors.home : 'transparent',
                  }}
                >
                  <span
                    className="text-[13px]"
                    style={{ color: currency === c.value ? colors.home : colors.text, fontWeight: currency === c.value ? 700 : 400 }}
                  >
                    {c.value}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 pb-8 pt-2">
            <button
              onClick={() => setStep(2)}
              className="w-full rounded-2xl py-[17px] text-base font-bold text-white active:opacity-90"
              style={{ backgroundColor: colors.home }}
            >
              {t.next}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 px-4">
            <button
              onClick={snapInstead}
              className="mb-[18px] w-full rounded-[20px] p-[18px] text-left active:opacity-90"
              style={{ backgroundColor: colors.home }}
            >
              <div className="mb-2 flex items-center gap-2.5">
                <Camera size={22} color="white" />
                <span className="text-base font-extrabold text-white">Snap your inventory sheet</span>
              </div>
              <p className="text-[13px] leading-relaxed text-white/85">
                Write Code · Item Name · Qty · Cost · Sell on paper and snap one photo — we&apos;ll fill in all your items at once.
              </p>
            </button>

            <div className="mb-4 flex items-center gap-2.5">
              <div className="h-px flex-1" style={{ backgroundColor: colors.border }} />
              <span className="text-[11px] font-bold tracking-wide text-sub">OR ADD ONE BY ONE</span>
              <div className="h-px flex-1" style={{ backgroundColor: colors.border }} />
            </div>

            <div className="mb-4 rounded-xl p-3.5" style={{ backgroundColor: colors.homeLight }}>
              <p className="text-[13px] font-semibold" style={{ color: colors.home }}>
                {t.setupTip}
              </p>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="mb-3 rounded-xl bg-white p-3.5">
                <FormField label={t.itemName} value={item.name} onChange={(e) => updateItem(idx, 'name', e.target.value)} placeholder="e.g. Bolt 6mm" />
                <UnitPicker label={t.unit} value={item.unit} onChange={(u) => updateItem(idx, 'unit', u)} />
                <div className="flex gap-2.5">
                  <FormField
                    label={t.costPrice}
                    containerClassName="flex-1"
                    value={item.cost}
                    onChange={(e) => updateItem(idx, 'cost', e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <FormField
                    label={t.sellPrice}
                    containerClassName="flex-1"
                    value={item.sell}
                    onChange={(e) => updateItem(idx, 'sell', e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </div>
                <FormField
                  label={t.openingStock}
                  value={item.stock}
                  onChange={(e) => updateItem(idx, 'stock', e.target.value)}
                  inputMode="decimal"
                  placeholder={t.openingStock}
                />
              </div>
            ))}
            <button
              onClick={addItemRow}
              className="mb-4 w-full rounded-xl border-2 border-dashed py-3.5 text-sm font-semibold text-sub"
              style={{ borderColor: colors.border }}
            >
              {t.addItem}
            </button>
          </div>
          <div className="px-4 pb-8 pt-2">
            <button
              onClick={finish}
              className="w-full rounded-2xl py-[17px] text-base font-bold text-white active:opacity-90"
              style={{ backgroundColor: colors.home }}
            >
              {t.startApp}
            </button>
            <button onClick={finish} className="mt-1 w-full py-3.5 text-sm text-sub">
              {t.skipSetup}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
