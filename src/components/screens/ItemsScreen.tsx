'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, Download } from 'lucide-react';
import { downloadCsv } from '@/lib/csvExport';
import { createClient } from '@/lib/supabase/client';
import { getAllProducts, addProduct, updateProduct, deleteProduct } from '@/lib/db/queries';
import { todayStr, Product } from '@/lib/types';
import { useLang } from '@/lib/i18n/LangContext';
import { useCurrency } from '@/lib/currency/CurrencyContext';
import { useToast } from '@/components/Toast';
import { useDialog } from '@/components/DialogProvider';
import ArcHeader from '@/components/ArcHeader';
import BottomSheet from '@/components/BottomSheet';
import FormField from '@/components/FormField';
import UnitPicker from '@/components/UnitPicker';
import UnitIcon from '@/components/UnitIcon';
import DataLoadError from '@/components/DataLoadError';
import PressableButton from '@/components/PressableButton';
import { colors, unitColor } from '@/lib/theme';

interface FormState {
  id: number | null;
  code: string;
  name: string;
  unit: string;
  cost: string;
  sell: string;
  stock: string;
}

const EMPTY_FORM: FormState = { id: null, code: '', name: '', unit: 'pcs', cost: '', sell: '', stock: '' };

export default function ItemsScreen() {
  const dialogs = useDialog();
  const router = useRouter();
  const { t } = useLang();
  const { currency } = useCurrency();
  const showToast = useToast();
  const supabase = createClient();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The query itself already pulls every product (search needs the full
  // set to filter against) — this caps what actually gets *rendered* at
  // once. Without it, a shop with 1000+ SKUs (hardware stores, for
  // instance) renders every row unconditionally and visibly lags on
  // scroll. Resets to the cap whenever the search term changes, so a new
  // search always starts from a fast, short list.
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const isEditing = form.id !== null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getAllProducts(supabase);
      setProducts(rows);
    } catch (err) {
      console.error('ItemsScreen load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load items');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return <DataLoadError message={error} onRetry={load} accentColor={colors.products} />;
  }

  const filtered = search
    ? products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : products;
  const visible = filtered.slice(0, visibleCount);

  function exportCsv() {
    downloadCsv(
      `items-${todayStr()}.csv`,
      ['Code', 'Name', 'Unit', 'Cost', 'Sell price', 'Stock', 'Margin %'],
      filtered.map((p) => [
        p.code ?? '',
        p.name,
        p.unit,
        p.avg_cost,
        p.sell_price,
        p.stock,
        p.sell_price > 0 ? Math.round(((p.sell_price - p.avg_cost) / p.sell_price) * 100) : 0,
      ])
    );
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(PAGE_SIZE);
  }

  function openAdd() {
    setForm(EMPTY_FORM);
    setModalVisible(true);
  }
  function openEdit(p: Product) {
    setForm({
      id: p.id,
      code: p.code || '',
      name: p.name,
      unit: p.unit,
      cost: String(p.avg_cost),
      sell: String(p.sell_price),
      stock: String(p.stock),
    });
    setModalVisible(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      showToast(t.itemName);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id: form.id as number,
        code: form.code.trim(),
        name,
        unit: form.unit,
        avg_cost: parseFloat(form.cost) || 0,
        sell_price: parseFloat(form.sell) || 0,
        stock: parseFloat(form.stock) || 0,
        created: todayStr(),
      };
      if (isEditing) {
        await updateProduct(supabase, payload);
      } else {
        await addProduct(supabase, payload);
      }
      setModalVisible(false);
      showToast(t.toastSaved);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await dialogs.confirm(`${form.name}\n${t.deleteItem}?`))) return;
    setDeleting(true);
    try {
      await deleteProduct(supabase, form.id as number);
      setModalVisible(false);
      showToast(t.toastDeleted);
      load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader
        title={t.myItems}
        subtitle={`${products.length} ${t.items}`}
        color={colors.products}
        onBack={() => router.back()}
      />

      <div className="flex-1 px-4 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-12 flex-1 items-center gap-2.5 rounded-xl bg-white px-3.5 shadow-sm">
            <Search size={18} color={colors.sub} />
            <input
              className="flex-1 bg-transparent text-[15px] text-foreground outline-none"
              placeholder={t.search}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Export to CSV"
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm disabled:opacity-40"
          >
            <Download size={18} color={colors.products} />
          </button>
        </div>

        <div className="space-y-2 pb-28">
          {loading ? (
            <p className="py-10 text-center text-sm text-sub">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-14">
              <p className="px-5 text-center text-sm text-sub">
                {search ? `No results for "${search}"` : t.noItems}
              </p>
            </div>
          ) : (
            visible.map((p) => {
              const margin = p.sell_price > 0 ? Math.round(((p.sell_price - p.avg_cost) / p.sell_price) * 100) : 0;
              return (
                <button
                  key={p.id}
                  onClick={() => openEdit(p)}
                  className="flex w-full items-center gap-3.5 rounded-xl bg-white px-4 py-3.5 text-left shadow-sm active:opacity-85"
                >
                  <div
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${unitColor(p.unit)}18` }}
                  >
                    <UnitIcon unit={p.unit} size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground">{p.name}</div>
                    <div className="mt-0.5 text-[11px] text-sub">
                      {p.stock} {p.unit} · {margin}% {t.margin_label}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold" style={{ color: colors.products }}>
                      {currency} {p.sell_price}
                    </div>
                    <div className="text-[11px] text-sub">Cost {currency} {p.avg_cost}</div>
                  </div>
                </button>
              );
            })
          )}
          {!loading && filtered.length > visible.length && (
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="w-full rounded-xl bg-white py-3 text-center text-sm font-semibold shadow-sm"
              style={{ color: colors.products }}
            >
              Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more ({filtered.length - visible.length} left)
            </button>
          )}
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-10 mx-auto max-w-md">
        <button
          onClick={openAdd}
          className="pointer-events-auto absolute bottom-4 right-5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg active:opacity-90"
          style={{ backgroundColor: colors.products }}
        >
          <Plus size={26} color="white" strokeWidth={2.5} />
        </button>
      </div>

      <BottomSheet visible={modalVisible} onClose={() => setModalVisible(false)}>
        <h2 className="mb-[18px] text-xl font-bold tracking-tight text-foreground">
          {isEditing ? form.name : t.addItem}
        </h2>
        <FormField
          label={t.code}
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="B001"
        />
        <UnitPicker label={t.unit} value={form.unit} onChange={(u) => setForm((f) => ({ ...f, unit: u }))} />
        <FormField
          label={t.itemName}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Bolt 6mm Zinc"
        />
        <div className="flex gap-2.5">
          <FormField
            label={t.costPrice}
            containerClassName="flex-1"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
            inputMode="decimal"
            placeholder="0.00"
          />
          <FormField
            label={t.sellPrice}
            containerClassName="flex-1"
            value={form.sell}
            onChange={(e) => setForm((f) => ({ ...f, sell: e.target.value }))}
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>
        <FormField
          label={t.openingStock}
          value={form.stock}
          onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
          inputMode="decimal"
          placeholder={t.openingStock}
        />
        <PressableButton
          onClick={handleSave}
          loading={saving}
          className="mt-1 w-full rounded-2xl py-[17px] text-base font-bold text-white"
          style={{ backgroundColor: colors.products }}
        >
          {t.saveItem}
        </PressableButton>
        {isEditing && (
          <PressableButton
            onClick={handleDelete}
            loading={deleting}
            loadingColor={colors.danger}
            className="mt-2 w-full rounded-xl bg-[#FEE2E2] py-3.5 text-[15px] font-semibold"
            style={{ color: colors.danger }}
          >
            {t.deleteItem}
          </PressableButton>
        )}
        <button onClick={() => setModalVisible(false)} className="mt-1 w-full py-3.5 text-sm text-sub">
          {t.cancel}
        </button>
      </BottomSheet>
    </div>
  );
}
