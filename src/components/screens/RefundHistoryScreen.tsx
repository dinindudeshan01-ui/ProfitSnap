'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import ArcHeader from '@/components/ArcHeader';
import LoadingOrbit from '@/components/LoadingOrbit';
import { colors } from '@/lib/theme';

interface RefundHistoryRow {
  id: number;
  scan_id: string;
  credits_requested: number;
  credits_approved: number | null;
  reason: string | null;
  decision_note: string | null;
  status: 'pending' | 'auto_approved' | 'approved' | 'denied';
  decided_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<RefundHistoryRow['status'], string> = {
  pending: 'Awaiting review',
  auto_approved: 'Refunded automatically',
  approved: 'Approved',
  denied: 'Denied',
};

const STATUS_COLOR: Record<RefundHistoryRow['status'], string> = {
  pending: colors.credits,
  auto_approved: colors.products,
  approved: colors.products,
  denied: '#E5484D',
};

export default function RefundHistoryScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<RefundHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/credits/refund')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load refund history');
        return d;
      })
      .then((d) => setRows(d.refunds ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load refund history'));
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Refund history" color={colors.credits} onBack={() => router.push('/credits')} />

      <div className="flex-1 px-5 pt-5 pb-8">
        {error && <p className="text-sm text-red-500">{error}</p>}

        {!error && rows === null && (
          <div className="flex justify-center pt-10">
            <LoadingOrbit color={colors.home} />
          </div>
        )}

        {!error && rows !== null && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16 text-center">
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: colors.creditsLight }}
            >
              <Undo2 size={24} color={colors.credits} />
            </div>
            <p className="text-sm text-sub">No refund requests yet.</p>
          </div>
        )}

        {!error && rows !== null && rows.length > 0 && (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const isPartial =
                (r.status === 'approved' || r.status === 'auto_approved') &&
                r.credits_approved !== null &&
                r.credits_approved < r.credits_requested;

              return (
                <div key={r.id} className="rounded-xl border p-3.5" style={{ borderColor: colors.border }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: STATUS_COLOR[r.status] }}>
                        {STATUS_LABEL[r.status]}
                        {isPartial ? ' (partial)' : ''}
                      </p>
                      <p className="mt-0.5 text-[11px] text-sub">
                        {new Date(r.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-sub">
                      {r.status === 'pending'
                        ? `${r.credits_requested} credits requested`
                        : `${r.credits_approved ?? 0} / ${r.credits_requested} credits`}
                    </span>
                  </div>

                  {r.reason && <p className="mt-2 text-xs text-sub">&quot;{r.reason}&quot;</p>}
                  {r.decision_note && (
                    <p className="mt-1 text-xs text-sub">Note from our team: {r.decision_note}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
