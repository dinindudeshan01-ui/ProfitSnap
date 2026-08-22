import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin) redirect('/admin/login');

  return (
    <div className="min-h-screen bg-[#0b0c0f] text-[#e8e9ec]">
      <header className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="font-semibold tracking-tight text-[15px]">
            ProfitSnap <span className="text-white/40">Admin</span>
          </Link>
          <nav className="flex gap-4 text-sm text-white/60">
            <Link href="/admin" className="hover:text-white transition-colors">
              Dashboard
            </Link>
            <Link href="/admin/ledger" className="hover:text-white transition-colors">
              Ledger
            </Link>
            <Link href="/admin/refunds" className="hover:text-white transition-colors">
              Refunds
            </Link>
            <Link href="/admin/billing" className="hover:text-white transition-colors">
              Billing
            </Link>
            <Link href="/admin/plans" className="hover:text-white transition-colors">
              Plans & Addons
            </Link>
            <Link href="/admin/escalations" className="hover:text-white transition-colors">
              Escalations
            </Link>
            <Link href="/admin/duplicates" className="hover:text-white transition-colors">
              Duplicates
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-white/60">
          <span>
            {admin.name} <span className="text-white/30">· {admin.role}</span>
          </span>
          <form action="/admin/logout" method="post">
            <button className="text-white/40 hover:text-white transition-colors">Sign out</button>
          </form>
        </div>
      </header>
      <main className="px-6 py-6 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
