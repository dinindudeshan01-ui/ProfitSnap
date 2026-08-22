'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { colors } from '@/lib/theme';
import { SRI_LANKA_DISTRICTS } from '@/lib/districts';

interface Plan {
  id: number;
  name: string;
  price_amount: number;
  currency: string;
  billing_period: string;
  credits_included: number;
  scan_limit_per_month: number | null;
  features: string[];
}

// A per-browser id, not a real hardware fingerprint — good enough to catch
// "same phone/browser, signed up twice" without any invasive fingerprinting
// library. Persists across signups from this browser; a different browser,
// incognito window, or cleared storage won't carry it over, which is a
// known, accepted gap (see migration-duplicate-detection.sql — this is a
// soft signal for admin review, not a hard block).
function getOrCreateDeviceId(): string {
  const KEY = 'psnap_device_id';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to a
    // one-off id; it just won't persist for next time.
    return crypto.randomUUID();
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [district, setDistrict] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // Distinct from `error` — this isn't a failure, it's the expected
  // outcome when the Supabase project requires email confirmation:
  // signUp succeeds but returns no session, so there's nothing to log
  // into yet. Previously the code pushed to '/' regardless, which just
  // silently bounced back to /login with zero explanation.
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  useEffect(() => {
    if (mode !== 'signup' || plans.length > 0) return;
    fetch('/api/plans')
      .then((r) => r.json())
      .then((d: { plans: Plan[] }) => {
        setPlans(d.plans ?? []);
        // Default to the first free plan if there is one — matches "if
        // they choose free, activate it automatically" without making
        // them hunt for it in the list.
        const free = d.plans?.find((p) => p.price_amount === 0);
        setSelectedPlanId(free?.id ?? d.plans?.[0]?.id ?? null);
      })
      .catch(() => setPlans([]));
  }, [mode, plans.length]);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    // Supabase's browser client auto-detects the recovery token in the
    // URL when the person clicks the emailed link and lands back on
    // /reset-password, establishing a temporary session there — no
    // separate token-handling code needed on this end.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    // Deliberately shown even if the email doesn't exist in the system —
    // confirming account existence via this form would be an enumeration
    // leak, so the message is identical either way.
    setResetSent(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    if (mode === 'signup') {
      if (!agreedToTerms) {
        setError('Please agree to the Terms of Service and Privacy Policy to continue');
        setLoading(false);
        return;
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { business_name: businessName || undefined, district: district || undefined } },
      });
      if (signUpError) {
        setError(signUpError.message);
        setLoading(false);
        return;
      }

      // No session back means the project requires email confirmation
      // before the account can actually be used — nothing below this
      // (fingerprinting, plan activation, navigating into the app) can
      // succeed without an authenticated request, so stop here and tell
      // the person to check their inbox instead of silently failing.
      if (!signUpData.session) {
        setAwaitingEmailConfirm(true);
        setLoading(false);
        return;
      }

      // Best-effort — a failure here should never block signup itself,
      // it just means this signup won't be checked for duplicates.
      try {
        await fetch('/api/tenant/fingerprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getOrCreateDeviceId() }),
        });
      } catch {
        // ignore
      }

      // Activate whatever plan they picked — for a free plan this starts
      // the 7-day trial countdown immediately (see
      // api/tenant/billing/[action]/route.ts). Also best-effort: if this
      // fails, they land on the app with no active plan and can pick one
      // from Settings instead, same as any tenant who signed up before
      // this picker existed.
      if (selectedPlanId !== null) {
        try {
          await fetch('/api/tenant/billing/change-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_id: selectedPlanId }),
          });
        } catch {
          // ignore
        }
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
    }

    router.push('/');
    router.refresh();
  }

  if (awaitingEmailConfirm) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-foreground">Check your email</h2>
        <p className="mb-5 text-sm text-sub">
          We&apos;ve sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Click
          it to activate your account, then come back and sign in.
        </p>
        <button
          onClick={() => {
            setAwaitingEmailConfirm(false);
            setMode('signin');
          }}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: colors.home }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-bold text-foreground">Reset password</h1>
          <p className="mb-6 text-sm text-sub">
            {resetSent
              ? "If that email has an account, we've sent a link to reset your password."
              : "Enter your account email and we'll send you a reset link."}
          </p>

          {!resetSent && (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-sub">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: colors.home }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <button
            onClick={() => {
              setMode('signin');
              setError(null);
              setResetSent(false);
            }}
            className="mt-4 w-full text-center text-sm text-sub"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold text-foreground">ProfitSnap</h1>
        <p className="mb-6 text-sm text-sub">
          {mode === 'signin' ? 'Sign in to your shop' : 'Create your shop account'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && plans.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs text-sub">Starting plan</label>
              <div className="space-y-2">
                {plans.map((p) => {
                  const isFree = p.price_amount === 0;
                  const selected = selectedPlanId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanId(p.id)}
                      className="w-full rounded-xl border px-3 py-2.5 text-left transition-colors"
                      style={{
                        borderColor: selected ? colors.home : 'var(--border-color, #E5E7EB)',
                        backgroundColor: selected ? colors.homeLight : 'transparent',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">{p.name}</span>
                        <span className="text-xs text-sub">
                          {p.price_amount === 0 ? 'Free' : `${p.currency} ${p.price_amount}/${p.billing_period}`}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-sub">
                        {p.credits_included} credits · {p.scan_limit_per_month ? `${p.scan_limit_per_month} scans/mo` : 'unlimited scans'}
                        {isFree ? ' · 7-day trial' : ''}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-sub">
                You can switch plans anytime from Settings. Picking a free plan starts its 7-day trial right away.
              </p>
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-xs text-sub">Business name</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Silva Traders"
                className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
              />
            </div>
          )}
          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-xs text-sub">District</label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
              >
                <option value="">Select district</option>
                {SRI_LANKA_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs text-sub">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-sub">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError(null);
              }}
              className="block text-right text-xs font-semibold text-sub"
              style={{ color: colors.home }}
            >
              Forgot password?
            </button>
          )}

          {mode === 'signup' && (
            <label className="flex items-start gap-2 text-xs text-sub">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" className="underline" style={{ color: colors.home }}>
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" className="underline" style={{ color: colors.home }}>
                  Privacy Policy
                </a>
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: colors.home }}
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
            setError(null);
          }}
          className="mt-4 w-full text-center text-sm text-sub"
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
