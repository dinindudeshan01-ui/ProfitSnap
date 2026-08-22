'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { SupabaseClient } from '@supabase/supabase-js';
import { Product } from '@/lib/types';
import { getAllProducts, addProduct } from '@/lib/db/queries';
import { colors } from '@/lib/theme';

interface ItemPickerProps {
  supabase: SupabaseClient;
  value: string; // free-text description, kept in sync with the selected product's name (or whatever the user typed if nothing matched)
  onChange: (text: string) => void;
  selectedProduct: Product | null;
  onSelectProduct: (p: Product | null) => void;
  accentColor?: string;
}

// QuickBooks-style item field: type to search the existing catalog, tap a
// match to link it (so the sale can decrement real stock), or — if nothing
// matches — create a brand-new product right here without leaving the sheet.
// Selecting nothing at all just keeps the typed text as a free-text note
// (e.g. "groceries") with no inventory link, which is the correct behavior
// for a credit sale that isn't tied to a catalog item.
export default function ItemPicker({
  supabase,
  value,
  onChange,
  selectedProduct,
  onSelectProduct,
  accentColor = colors.creditSale,
}: ItemPickerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCost, setNewCost] = useState('');
  const [newSell, setNewSell] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAllProducts(supabase)
      .then(setProducts)
      .catch(() => {});
  }, [supabase]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const query = value.trim().toLowerCase();
  const matches =
    query.length === 0
      ? []
      : products
          .filter(
            (p) =>
              p.name.toLowerCase().includes(query) ||
              (p.code && p.code.toLowerCase().includes(query))
          )
          .slice(0, 6);

  const exactMatch = products.some((p) => p.name.toLowerCase() === query);

  function pick(p: Product) {
    onSelectProduct(p);
    onChange(p.name);
    setOpen(false);
  }

  function clearSelection() {
    onSelectProduct(null);
    onChange('');
    setOpen(true);
  }

  async function createNew() {
    const name = value.trim();
    if (!name) return;
    setSavingNew(true);
    try {
      const cost = parseFloat(newCost) || 0;
      const sell = parseFloat(newSell) || 0;
      const id = await addProduct(supabase, {
        code: '',
        name,
        unit: 'pcs',
        avg_cost: cost,
        sell_price: sell,
        stock: 0,
        created: new Date().toISOString().slice(0, 10),
      });
      const created: Product = {
        id,
        code: '',
        name,
        unit: 'pcs',
        avg_cost: cost,
        sell_price: sell,
        stock: 0,
        created: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      };
      setProducts((prev) => [...prev, created]);
      pick(created);
      setCreating(false);
      setNewCost('');
      setNewSell('');
    } catch (err) {
      console.error('Failed to create item:', err);
    } finally {
      setSavingNew(false);
    }
  }

  if (selectedProduct) {
    return (
      <div
        className="flex items-center justify-between rounded-xl border px-3.5 py-3"
        style={{ borderColor: accentColor, backgroundColor: `${accentColor}14` }}
      >
        <div>
          <div className="text-sm font-semibold text-foreground">{selectedProduct.name}</div>
          <div className="text-[11px] text-sub">
            In stock: {selectedProduct.stock} {selectedProduct.unit}
          </div>
        </div>
        <button onClick={clearSelection} className="p-1" aria-label="Clear item selection">
          <X size={16} color={colors.sub} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3.5 py-3">
        <Search size={14} color={colors.sub} />
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setCreating(false);
          }}
          onFocus={() => setOpen(true)}
          placeholder="e.g. groceries, or search items…"
          className="w-full bg-transparent text-sm text-foreground outline-none"
        />
      </div>

      {open && query.length > 0 && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-white shadow-lg">
          {creating ? (
            <div className="p-3.5">
              <div className="mb-2.5 text-[13px] font-semibold text-foreground">
                New item: &ldquo;{value.trim()}&rdquo;
              </div>
              <div className="mb-2.5 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">Cost</label>
                  <input
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                    className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[9px] font-bold uppercase text-sub">Sell price</label>
                  <input
                    value={newSell}
                    onChange={(e) => setNewSell(e.target.value)}
                    placeholder="0"
                    inputMode="decimal"
                    className="w-full rounded-md bg-bg px-2 py-1.5 text-xs text-foreground outline-none"
                  />
                </div>
              </div>
              <button
                onClick={createNew}
                disabled={savingNew}
                className="w-full rounded-lg py-2 text-xs font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: accentColor }}
              >
                {savingNew ? 'Saving…' : 'Create & use this item'}
              </button>
            </div>
          ) : (
            <>
              {matches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className="flex w-full items-center justify-between border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-bg"
                >
                  <span className="text-sm text-foreground">{p.name}</span>
                  <span className="text-[11px] text-sub">
                    {p.stock} {p.unit} left
                  </span>
                </button>
              ))}
              {!exactMatch && (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
                  style={{ color: accentColor }}
                >
                  <Plus size={14} color={accentColor} />
                  <span className="text-sm font-semibold">Add &ldquo;{value.trim()}&rdquo; as new item</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
