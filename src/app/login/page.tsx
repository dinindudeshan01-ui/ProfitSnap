'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
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

function getOrCreateDeviceId(): string {
  const KEY = 'psnap_device_id';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// ---------- Icons for the social sign-in row ----------
// Plain functional marks (not stylized reproductions) — standard practice
// for auth buttons. These are placeholders: onClick just shows a "coming
// soon" state until the corresponding provider is wired up in Supabase.

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path
        fill="#1877F2"
        d="M18 9a9 9 0 1 0-10.4 8.89v-6.29H5.31V9h2.29V7.02c0-2.26 1.35-3.51 3.41-3.51.99 0 2.02.18 2.02.18v2.22h-1.14c-1.12 0-1.47.7-1.47 1.41V9h2.5l-.4 2.6h-2.1v6.29A9 9 0 0 0 18 9Z"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function SocialButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-12 flex-1 items-center justify-center rounded-xl border border-border bg-white active:opacity-70"
    >
      {icon}
    </button>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [district, setDistrict] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [awaitingEmailConfirm, setAwaitingEmailConfirm] = useState(false);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  useEffect(() => {
    if (mode !== 'signup' || plans.length > 0) return;
    fetch('/api/plans')
      .then((r) => r.json())
      .then((d: { plans: Plan[] }) => {
        setPlans(d.plans ?? []);
        const free = d.plans?.find((p) => p.price_amount === 0);
        setSelectedPlanId(free?.id ?? d.plans?.[0]?.id ?? null);
      })
      .catch(() => setPlans([]));
  }, [mode, plans.length]);

  useEffect(() => {
    if (!comingSoon) return;
    const t = setTimeout(() => setComingSoon(null), 2500);
    return () => clearTimeout(t);
  }, [comingSoon]);

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
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

      if (!signUpData.session) {
        setAwaitingEmailConfirm(true);
        setLoading(false);
        return;
      }

      try {
        await fetch('/api/tenant/fingerprint', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getOrCreateDeviceId() }),
        });
      } catch {
        // ignore
      }

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
    <div className="flex min-h-full flex-col">
      {/* Illustration panel */}
      <div
        className="flex flex-col items-center justify-center px-6 pb-8 pt-10"
        style={{ background: `linear-gradient(180deg, ${colors.home}22, ${colors.home}08)` }}
      >
        <img src="/login-mascot.png" alt="" className="h-40 w-40 object-contain" />
      </div>

      {/* Form card */}
      <div className="flex-1 rounded-t-[28px] bg-white px-6 pb-8 pt-7 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-bold text-foreground">
            Profit<span style={{ color: colors.home }}>Snap</span>
          </h1>
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
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border px-3 py-2.5 pr-10 text-sm outline-none focus:border-home"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sub"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                }}
                className="block text-right text-xs font-semibold"
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
              className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: colors.home }}
            >
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {/* Social sign-in row — placeholders until providers are wired up in Supabase */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-sub">or continue with</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex gap-3">
            <SocialButton icon={<GoogleIcon />} label="Continue with Google" onClick={() => setComingSoon('Google sign-in')} />
            <SocialButton icon={<FacebookIcon />} label="Continue with Facebook" onClick={() => setComingSoon('Facebook sign-in')} />
            <SocialButton icon={<PhoneIcon />} label="Continue with phone" onClick={() => setComingSoon('Phone sign-in')} />
          </div>
          {comingSoon && (
            <p className="mt-2 text-center text-xs text-sub">{comingSoon} is coming soon.</p>
          )}

          <button
            onClick={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setError(null);
            }}
            className="mt-5 w-full text-center text-sm text-sub"
          >
            {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}
