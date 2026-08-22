'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TxRow {
  id: number;
  type: string;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
  tenant_id: string;
  business_name: string;
}

export default function LedgerPage() {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/ledger')
      .then((r) => r.json())
      .then((d) => setRows(d.transactions ?? []))
      .finally(() => setLoading(false));
  }, []);

  const totals = rows.reduce(
    (acc, r) => {
      if (r.amount > 0) acc.in += r.amount;
      else acc.out += r.amount;
      return acc;
    },
    { in: 0, out: 0 }
  );

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Global ledger</h1>
      <p className="text-white/40 text-sm mb-6">Last 200 credit movements across every tenant.</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-white/40 text-xs">Credits in (window)</p>
          <p className="text-emerald-400 text-lg font-semibold">+{totals.in}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-white/40 text-xs">Credits out (window)</p>
          <p className="text-red-400 text-lg font-semibold">{totals.out}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-white/40 text-xs">Net (window)</p>
          <p className="text-white text-lg font-semibold">{totals.in + totals.out}</p>
        </div>
      </div>

      {loading && <p className="text-white/40 text-sm">Loading…</p>}

      <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/admin/customers/${r.tenant_id}`}
            className="flex justify-between items-center px-4 py-3 hover:bg-white/5 transition-colors"
          >
            <div>
              <p className="text-white/80 text-sm">
                {r.business_name} <span className="text-white/30">· {r.type}</span>
              </p>
              <p className="text-white/30 text-xs">{r.note || '—'}</p>
            </div>
            <div className="text-right">
              <p className={`text-sm ${r.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {r.amount >= 0 ? '+' : ''}
                {r.amount}
              </p>
              <p className="text-white/30 text-xs">{new Date(r.created_at).toLocaleString()}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
