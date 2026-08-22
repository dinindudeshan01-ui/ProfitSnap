'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import ArcHeader from '@/components/ArcHeader';
import { useToast } from '@/components/Toast';
import PressableButton from '@/components/PressableButton';
import LoadingOrbit from '@/components/LoadingOrbit';
import { colors } from '@/lib/theme';
import { RefundOutcome } from '@/lib/types';

function RefundScreenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showToast = useToast();
  const scanId = searchParams.get('scanId');

  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RefundOutcome | null>(null);

  async function submit() {
    if (!scanId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/credits/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Could not submit refund request');
      setResult(data.refund);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not submit refund request');
    } finally {
      setSubmitting(false);
    }
  }

  if (!scanId) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm text-sub">No scan selected.</p>
        <button onClick={() => router.push('/credits')} className="mt-3 text-sm font-semibold" style={{ color: colors.credits }}>
          Back to credits
        </button>
      </div>
    );
  }

  if (result) {
    const isAuto = result.status === 'auto_approved';
    const isAlready = result.alreadyRequested;
    return (
      <div className="flex min-h-full flex-col">
        <ArcHeader title="Refund request" color={colors.credits} onBack={() => router.push('/credits')} />
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: isAuto ? colors.productsLight : colors.creditsLight }}
          >
            <Undo2 size={28} color={isAuto ? colors.products : colors.credits} />
          </div>
          <h2 className="mb-2 text-lg font-bold text-foreground">
            {isAlready
              ? 'Already requested'
              : isAuto
              ? 'Refunded instantly'
              : 'Sent for review'}
          </h2>
          <p className="mb-1 text-sm text-sub">
            {isAlready
              ? `This scan's refund request is currently "${result.status}".`
              : isAuto
              ? `${result.creditsRefunded} credits were refunded automatically — this scan was charged but never updated your inventory.`
              : "Since your inventory was updated from this scan, we've queued this for our team to review. You'll be refunded if approved."}
          </p>
          <button
            onClick={() => router.push('/credits')}
            className="mt-5 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: colors.credits }}
          >
            Back to credits
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ArcHeader title="Request a refund" color={colors.credits} onBack={() => router.back()} />
      <div className="flex-1 px-5 pt-5">
        <div className="mb-4 rounded-xl p-3.5" style={{ backgroundColor: colors.creditsLight }}>
          <p className="text-[12px] leading-relaxed" style={{ color: colors.credits }}>
            If this scan charged you credits but never updated your inventory, you&apos;ll be refunded
            instantly. If your inventory WAS updated, our team will review your request manually.
          </p>
        </div>

        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-sub">
          What went wrong? (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. quantities were misread, wrong items added…"
          className="min-h-[100px] w-full rounded-xl bg-bg p-3.5 text-sm text-foreground outline-none"
        />
      </div>
      <div className="px-5 pb-8 pt-3">
        <PressableButton
          onClick={submit}
          loading={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white"
          style={{ backgroundColor: colors.credits }}
        >
          Submit refund request
        </PressableButton>
      </div>
    </div>
  );
}

export default function RefundScreen() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center">
          <LoadingOrbit size={48} color={colors.home} />
        </div>
      }
    >
      <RefundScreenInner />
    </Suspense>
  );
}
