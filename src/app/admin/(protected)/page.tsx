'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import TenantDistrictMap from '@/components/admin/TenantDistrictMap';

interface TenantResult {
  id: string;
  business_name: string;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string;
  pendingDuplicate?: boolean;
  hasPendingIssue?: boolean;
}

interface Stats {
  total: number;
  active: number;
  trial: number;
  suspended: number;
  pendingFlags: number;
  pendingRefunds: number;
  totalStorageBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Same StatCard pattern as King of Spices' admin dashboard — small dark
// card, uppercase label, big number, optional accent color.
function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-4 flex-1 min-w-[130px]">
      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-2xl font-black" style={{ color: accent ?? '#f0f2f6' }}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-400',
    suspended: 'bg-red-500/15 text-red-400',
    trial: 'bg-amber-500/15 text-amber-400',
  };
  return (
    <span className={`text-xs px-2 py-1 rounded-full ${styles[status] ?? 'bg-white/10 text-white/50'}`}>
      {status}
    </span>
  );
}

// Shared row for every tenant list on this page (search results, a
// clicked district's shops, and the always-visible full list) — one
// definition means the red-flagging logic (duplicate flag vs. pending
// issue vs. both) can't drift between the three call sites.
function TenantRow({ t, compact }: { t: TenantResult; compact?: boolean }) {
  const flagged = t.pendingDuplicate || t.hasPendingIssue;
  return (
    <Link
      href={`/admin/customers/${t.id}`}
      className={`block rounded-lg border transition-colors px-4 py-3 ${
        flagged ? 'border-red-500/50 bg-red-500/10 hover:bg-red-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-white text-sm font-medium flex items-center gap-1.5">
            {flagged && <span className="text-red-400 shrink-0">⚠</span>}
            <span className="truncate">{t.business_name}</span>
          </p>
          <p className="text-white/40 text-xs mt-0.5">
            {compact ? (
              <>{t.email || '—'} · {t.status}</>
            ) : (
              <>{t.owner_name || '—'} · {t.phone || '—'} · {t.email || '—'}</>
            )}
          </p>
          {flagged && (
            <p className="text-red-400 text-[11px] mt-0.5">
              {[t.pendingDuplicate && 'Possible duplicate', t.hasPendingIssue && 'Unresolved report/refund']
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        <StatusBadge status={t.status} />
      </div>
    </Link>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TenantResult[]>([]);
  const [loading, setLoading] = useState(false);

  const [districtCounts, setDistrictCounts] = useState<Record<string, number>>({});
  const [issueDistricts, setIssueDistricts] = useState<string[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [districtTenants, setDistrictTenants] = useState<TenantResult[]>([]);
  // The full tenant list, shown by default on the left — previously this
  // panel stayed empty until a search or district click, which meant an
  // admin who just wanted to see "who has something pending right now"
  // had no way to get there without already knowing where to look.
  const [allTenants, setAllTenants] = useState<TenantResult[]>([]);
  const [allTenantsLoading, setAllTenantsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then(setStats);
    fetch('/api/admin/tenants-by-district')
      .then((r) => r.json())
      .then((d) => {
        setDistrictCounts(d.counts ?? {});
        setIssueDistricts(d.issueDistricts ?? []);
        setAllTenants(d.tenants ?? []);
      })
      .finally(() => setAllTenantsLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedDistrict) {
      setDistrictTenants([]);
      return;
    }
    fetch(`/api/admin/tenants-by-district?district=${encodeURIComponent(selectedDistrict)}`)
      .then((r) => r.json())
      .then((d) => setDistrictTenants(d.tenants ?? []));
  }, [selectedDistrict]);

  const runSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(q), 250);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  return (
    <div>
      <h1 className="text-white text-xl font-semibold mb-1">Dashboard</h1>
      <p className="text-white/40 text-sm mb-6">Everything at a glance, and a search box to jump straight to a shop.</p>

      {/* Stat card row — same layout as King of Spices' admin dashboard */}
      {stats && (
        <div className="flex flex-wrap gap-3 mb-8">
          <StatCard label="Total Shops" value={stats.total} />
          <StatCard label="Active" value={stats.active} accent="#34d399" />
          <StatCard label="On Trial" value={stats.trial} accent="#facc15" />
          <StatCard label="Suspended" value={stats.suspended} accent="#f87171" />
          <StatCard label="Pending Refunds" value={stats.pendingRefunds} accent="#6FA8DC" />
          <StatCard label="Flagged Duplicates" value={stats.pendingFlags} accent="#f87171" />
          <StatCard label="Snap Storage" value={formatBytes(stats.totalStorageBytes)} accent="#c8d5e0" />
        </div>
      )}

      <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
        {/* Left — search takes priority when typed, then a clicked
            district, then the full tenant list by default — never empty,
            so an admin can always see who has something pending without
            first knowing who to look for. */}
        <div>
          <p className="text-xs font-bold text-white/50 uppercase tracking-wide mb-2">Customer lookup</p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Silva Traders, +9477…, ander@..."
            className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-white text-sm outline-none focus:border-white/30 mb-4"
          />

          {q.trim().length >= 2 ? (
            <>
              {loading && <p className="text-white/30 text-sm">Searching…</p>}
              {!loading && results.length === 0 && <p className="text-white/30 text-sm">No matches for &ldquo;{q}&rdquo;.</p>}
              <div className="space-y-2">
                {results.map((t) => (
                  <TenantRow key={t.id} t={t} />
                ))}
              </div>
            </>
          ) : selectedDistrict ? (
            <div>
              <p className="text-xs font-bold text-white/50 mb-3">
                {selectedDistrict} — {districtTenants.length} shop{districtTenants.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-2">
                {districtTenants.map((t) => (
                  <TenantRow key={t.id} t={t} compact />
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-white/50 mb-3">
                All shops ({allTenants.length})
                {allTenants.some((t) => t.hasPendingIssue || t.pendingDuplicate) && (
                  <span className="ml-2 text-red-400 font-normal normal-case">
                    — {allTenants.filter((t) => t.hasPendingIssue || t.pendingDuplicate).length} need attention
                  </span>
                )}
              </p>
              {allTenantsLoading && <p className="text-white/30 text-sm">Loading…</p>}
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {allTenants.map((t) => (
                  <TenantRow key={t.id} t={t} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — map sits as a sidebar, not the main focus */}
        <TenantDistrictMap
          districtCounts={districtCounts}
          issueDistricts={issueDistricts}
          selectedDistrict={selectedDistrict}
          onDistrictClick={setSelectedDistrict}
        />
      </div>
    </div>
  );
}
