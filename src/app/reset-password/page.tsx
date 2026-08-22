'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { colors } from '@/lib/theme';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Supabase's browser client parses the recovery token out of the URL on
  // load and exchanges it for a temporary session automatically — but
  // that exchange is async, so the form is disabled until it resolves.
  // Without this check, a person who arrives here with an already-expired
  // or malformed link would see a normal-looking form that fails
  // confusingly on submit instead of a clear "link isn't valid" message.
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        setSessionError(true);
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  if (sessionError) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-foreground">This link isn&apos;t valid</h2>
        <p className="mb-5 text-sm text-sub">
          It may have expired or already been used. Request a new reset link from the sign-in page.
        </p>
        <button
          onClick={() => router.push('/login')}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: colors.home }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-foreground">Password updated</h2>
        <p className="mb-5 text-sm text-sub">You can now sign in with your new password.</p>
        <button
          onClick={() => router.push('/login')}
          className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: colors.home }}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold text-foreground">Set a new password</h1>
        <p className="mb-6 text-sm text-sub">Choose a new password for your account.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-sub">New password</label>
            <input
              type="password"
              required
              minLength={6}
              disabled={!sessionReady}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-sub">Confirm password</label>
            <input
              type="password"
              required
              minLength={6}
              disabled={!sessionReady}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-home disabled:opacity-50"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading || !sessionReady}
            className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: colors.home }}
          >
            {!sessionReady ? 'Verifying link…' : loading ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
