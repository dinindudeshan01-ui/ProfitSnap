// Data access layer — mirrors the original src/db/queries.js from the Expo
// app function-for-function, but talking to Supabase/Postgres instead of
// expo-sqlite. Business logic (weighted-average cost, stock deduction) is
// ported exactly so profit/stock math stays identical between platforms.

import { SupabaseClient } from '@supabase/supabase-js';
import { Product, Sale, SaleWithProduct, StockIn, round4, todayStr } from '../types';
import { getCached, setCached } from '../offlineCache';

function asError(err: unknown, fallback: string): Error {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const msg =
      (anyErr.message as string) || (anyErr.error_description as string) || (anyErr.hint as string);
    return new Error(msg ? `${fallback}: ${msg}` : `${fallback}: ${JSON.stringify(err)}`);
  }
  return new Error(`${fallback}: ${String(err)}`);
}

// ---------- PRODUCTS ----------

const PRODUCTS_CACHE_KEY = 'allProducts';

export async function getAllProducts(db: SupabaseClient): Promise<Product[]> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = getCached<Product[]>(PRODUCTS_CACHE_KEY);
    if (cached) return cached.value;
    throw new Error("You're offline and no product list has been saved on this device yet. Connect once to load your items.");
  }

  try {
    const { data, error } = await db.from('products').select('*').order('name', { ascending: true });
    if (error) throw asError(error, 'Failed to load products');
    const products = data ?? [];
    setCached(PRODUCTS_CACHE_KEY, products);
    return products;
  } catch (err) {
    const cached = getCached<Product[]>(PRODUCTS_CACHE_KEY);
    if (cached) return cached.value;
    throw err;
  }
}

export async function getProduct(db: SupabaseClient, id: number): Promise<Product | null> {
  const { data, error } = await db.from('products').select('*').eq('id', id).maybeSingle();
  if (error) throw asError(error, 'Failed to load product');
  return data;
}

export async function addProduct(
  db: SupabaseClient,
  p: Omit<Product, 'id' | 'created_at'>
): Promise<number> {
  const { data, error } = await db
    .from('products')
    .insert({
      code: p.code || '',
      name: p.name,
      unit: p.unit,
      avg_cost: p.avg_cost,
      sell_price: p.sell_price,
      stock: p.stock,
      created: p.created,
    })
    .select('id')
    .single();
  if (error) throw asError(error, 'Failed to add product');
  return data.id;
}

export async function updateProduct(
  db: SupabaseClient,
  p: Pick<Product, 'id' | 'code' | 'name' | 'unit' | 'avg_cost' | 'sell_price' | 'stock'>
): Promise<void> {
  const { error } = await db
    .from('products')
    .update({
      code: p.code || '',
      name: p.name,
      unit: p.unit,
      avg_cost: p.avg_cost,
      sell_price: p.sell_price,
      stock: p.stock,
    })
    .eq('id', p.id);
  if (error) throw asError(error, 'Failed to update product');
}

export async function deleteProduct(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from('products').delete().eq('id', id);
  if (error) throw asError(error, 'Failed to delete product');
}

// ---------- SALES ----------

const SALES_CACHE_KEY = 'allSales';

export async function getAllSales(db: SupabaseClient): Promise<Sale[]> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = getCached<Sale[]>(SALES_CACHE_KEY);
    if (cached) return cached.value;
    throw new Error("You're offline and no sales history has been saved on this device yet. Connect once to load your data.");
  }

  try {
    const { data, error } = await db.from('sales').select('*').order('date', { ascending: false });
    if (error) throw asError(error, 'Failed to load sales');
    const sales = data ?? [];
    setCached(SALES_CACHE_KEY, sales);
    return sales;
  } catch (err) {
    const cached = getCached<Sale[]>(SALES_CACHE_KEY);
    if (cached) return cached.value;
    throw err;
  }
}

export async function getSalesForDate(db: SupabaseClient, date: string): Promise<SaleWithProduct[]> {
  const { data, error } = await db
    .from('sales')
    .select('*, products(name, unit)')
    .eq('date', date)
    .order('id', { ascending: false });
  if (error) throw asError(error, 'Failed to load sales for date');
  return (data ?? []).map((row: any) => ({
    ...row,
    pname: row.products?.name ?? '',
    punit: row.products?.unit ?? '',
  }));
}

export async function addSale(
  db: SupabaseClient,
  s: { pid: number; qty: number; sell_price: number; avg_cost: number; date: string }
): Promise<number> {
  const { data, error } = await db.from('sales').insert(s).select('id').single();
  if (error) throw asError(error, 'Failed to record sale');
  return data.id;
}

export async function reverseSale(db: SupabaseClient, saleId: number): Promise<void> {
  const { data: sale, error: fetchErr } = await db.from('sales').select('pid, qty').eq('id', saleId).single();
  if (fetchErr) throw asError(fetchErr, 'Failed to load sale to undo');

  const { error: deleteErr } = await db.from('sales').delete().eq('id', saleId);
  if (deleteErr) throw asError(deleteErr, 'Failed to undo sale');

  const p = await getProduct(db, sale.pid);
  if (p) {
    const { error: stockErr } = await db
      .from('products')
      .update({ stock: round4(p.stock + sale.qty) })
      .eq('id', sale.pid);
    if (stockErr) throw asError(stockErr, 'Sale was removed but restocking failed — check stock manually');
  }
}

export async function deductStock(db: SupabaseClient, pid: number, qty: number): Promise<void> {
  const p = await getProduct(db, pid);
  if (!p) return;
  const newStock = Math.max(0, p.stock - qty);
  const { error } = await db.from('products').update({ stock: round4(newStock) }).eq('id', pid);
  if (error) throw asError(error, 'Failed to update stock after sale');
}

// ---------- STOCK IN ----------

export async function addStockIn(
  db: SupabaseClient,
  s: { pid: number; qty: number; cost: number; date: string }
): Promise<void> {
  const { error } = await db.from('stock_in').insert(s);
  if (error) throw asError(error, 'Failed to record stock-in');
}

export async function applyStockIn(
  db: SupabaseClient,
  pid: number,
  qty: number,
  cost: number
): Promise<{ stockInId: number; previousStock: number; previousAvgCost: number }> {
  const p = await getProduct(db, pid);
  if (!p) throw new Error('Product not found');
  const previousStock = p.stock;
  const previousAvgCost = p.avg_cost;
  const totalQty = p.stock + qty;
  const newAvg = totalQty > 0 ? (p.stock * p.avg_cost + qty * cost) / totalQty : cost;

  const { error } = await db
    .from('products')
    .update({ stock: round4(totalQty), avg_cost: round4(newAvg) })
    .eq('id', pid);
  if (error) throw asError(error, 'Failed to apply stock-in');

  const { data: stockInRow, error: insertErr } = await db
    .from('stock_in')
    .insert({ pid, qty, cost, date: todayStr() })
    .select('id')
    .single();
  if (insertErr) throw asError(insertErr, 'Failed to record stock-in');

  return { stockInId: stockInRow.id, previousStock, previousAvgCost };
}

export async function reverseStockIn(
  db: SupabaseClient,
  args: { stockInId: number; pid: number; previousStock: number; previousAvgCost: number }
): Promise<void> {
  const { error: deleteErr } = await db.from('stock_in').delete().eq('id', args.stockInId);
  if (deleteErr) throw asError(deleteErr, 'Failed to undo stock-in');

  const { error: restoreErr } = await db
    .from('products')
    .update({ stock: round4(args.previousStock), avg_cost: round4(args.previousAvgCost) })
    .eq('id', args.pid);
  if (restoreErr) throw asError(restoreErr, 'Stock-in was removed but restoring the product failed — check stock manually');
}

export async function getAllStockIn(db: SupabaseClient): Promise<(StockIn & { pname: string; punit: string })[]> {
  const { data, error } = await db
    .from('stock_in')
    .select('*, products(name, unit)')
    .order('created_at', { ascending: false });
  if (error) throw asError(error, 'Failed to load stock-in history');
  return (data ?? []).map((row: any) => ({
    ...row,
    pname: row.products?.name ?? '',
    punit: row.products?.unit ?? '',
  }));
}

// ---------- SETTINGS ----------

export async function getSetting(db: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw asError(error, `Failed to load setting "${key}"`);
  return data ? data.value : null;
}

export async function setSetting(db: SupabaseClient, key: string, value: string): Promise<void> {
  const { error } = await db.from('settings').upsert({ key, value });
  if (error) throw asError(error, `Failed to save setting "${key}"`);
}

export type { StockIn };
