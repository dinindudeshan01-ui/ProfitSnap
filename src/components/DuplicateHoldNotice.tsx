'use client';

import { useEffect, useState } from 'react';
import { colors } from '@/lib/theme';

interface HoldStatus {
  held: boolean;
  flagId?: number;
  appealNote?: string | null;
  appealSubmittedAt?: string | null;
}

// Shown on the Credits screen when the tenant's free-trial credits are on
// hold pending a duplicate-shop review (see migration-duplicate-detection.sql).
// The tenant isn't told anything scary — just that a review is happening
// and they can explain their situation before it's decided.
export default function DuplicateHoldNotice() {
  const [status, setStatus] = useState<HoldStatus | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch('/api/tenant/duplicate-status')
      .then((r) => r.json())
      .then((d: HoldStatus) => {
        setStatus(d);
        if (d.appealNote) setMessage(d.appealNote);
      })
      .catch(() => {});
  }, []);

  if (!status?.held) return null;

  const alreadyAppealed = !!status.appealNote;

  async function submitAppeal() {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tenant/duplicate-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (res.ok) setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: '#FEF3C7' }}>
      <p className="text-sm font-bold" style={{ color: '#92400E' }}>
        Your trial credits are on hold
      </p>
      <p className="mt-1 text-xs" style={{ color: '#92400E' }}>
        This account was signed up from a device or connection already linked to another shop, so we're holding
        the free trial credits for a quick manual review. You can keep using the app in the meantime — if you have
        a real reason for two shops (a shared shop tablet, a second branch, etc.), let us know below and we'll
        take that into account.
      </p>

      {submitted || alreadyAppealed ? (
        <div className="mt-3 rounded-xl bg-white/60 p-3">
          <p className="text-xs font-semibold" style={{ color: '#92400E' }}>
            Your note{status.appealSubmittedAt ? ` (sent ${new Date(status.appealSubmittedAt).toLocaleDateString()})` : ''}:
          </p>
          <p className="mt-1 text-xs" style={{ color: '#92400E' }}>{message}</p>
        </div>
      ) : (
        <div className="mt-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. This is our second branch, run by the same family from one tablet."
            rows={3}
            className="w-full rounded-xl border border-amber-300 bg-white/70 p-2.5 text-xs text-foreground outline-none placeholder:text-amber-700/40"
          />
          <button
            onClick={submitAppeal}
            disabled={submitting || !message.trim()}
            className="mt-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: colors.credits }}
          >
            {submitting ? 'Sending…' : 'Send explanation'}
          </button>
        </div>
      )}
    </div>
  );
}
