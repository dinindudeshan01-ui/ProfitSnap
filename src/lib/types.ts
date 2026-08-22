// Shared types — mirror the Postgres schema in supabase/schema.sql,
// which itself mirrors the original expo-sqlite schema field-for-field.

export interface Product {
  id: number;
  code: string | null;
  name: string;
  unit: string;
  avg_cost: number;
  sell_price: number;
  stock: number;
  created: string | null;
  created_at: string;
}

export interface Sale {
  id: number;
  pid: number;
  qty: number;
  sell_price: number;
  avg_cost: number;
  date: string;
  created_at: string;
}

export interface SaleWithProduct extends Sale {
  pname: string;
  punit: string;
}

export interface StockIn {
  id: number;
  pid: number;
  qty: number;
  cost: number;
  date: string;
  created_at: string;
}

export type ScanType = 'setup' | 'stock_in' | 'sales' | 'credit_sale';
export type ScanOutcome = 'ocr_success' | 'ocr_failed' | 'staff_escalation';

export interface ScanRow {
  code?: string;
  name: string;
  qty?: string | number;
  cost?: string | number;
  sell?: string | number;
  customer_name?: string;
  customer_phone?: string;
  description?: string;
  amount?: string | number;
}

export interface ScanResult {
  ok: boolean;
  rows?: ScanRow[];
  error?: string;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function round4(n: number): number {
  return parseFloat(n.toFixed(4));
}

// ── Credit engine types ───────────────────────────────────────────────────

export type CreditTxType =
  | 'topup'
  | 'scan_charge'
  | 'retake_charge'
  | 'refund_auto'
  | 'refund_approved'
  | 'adjustment';

export type RefundStatus = 'auto_approved' | 'pending' | 'approved' | 'denied';

export interface ScanLogSummary {
  id: string;
  scan_type: ScanType;
  outcome: ScanOutcome;
  row_count: number | null;
  retake_count: number;
  credits_charged: number;
  rows_committed: boolean;
  photo_path: string | null;
}

export interface CreditTransaction {
  id: number;
  type: CreditTxType;
  amount: number; // positive = credit, negative = debit
  balance_after: number;
  note: string | null;
  created_at: string;
  scan_id: string | null;
  scan_log: ScanLogSummary | null;
}

export interface RefundOutcome {
  status: RefundStatus;
  creditsRefunded?: number;
  reason?: string;
  alreadyRequested?: boolean;
}
