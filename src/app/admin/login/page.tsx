'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.user) {
      setError('Invalid email or password.');
      setLoading(false);
      return;
    }
    // Confirm this account is actually an admin before letting the layout
    // gate pass — a valid Supabase login doesn't mean admin_users has them.
    const { data: adminRow } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!adminRow) {
      setError('This account does not have admin access.');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }
    router.push('/admin');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#0b0c0f] flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white/5 border border-white/10 rounded-xl p-6"
      >
        <h1 className="text-white text-lg font-semibold mb-1">Admin sign in</h1>
        <p className="text-white/40 text-sm mb-6">ProfitSnap operator access</p>
        <label className="block text-white/60 text-xs mb-1">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30"
        />
        <label className="block text-white/60 text-xs mb-1">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 rounded-lg bg-white/10 border border-white/10 px-3 py-2 text-white text-sm outline-none focus:border-white/30"
        />
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-white text-black font-medium text-sm py-2 disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
