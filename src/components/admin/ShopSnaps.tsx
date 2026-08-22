'use client';

import { useEffect, useState, useCallback } from 'react';

interface Photo {
  id: number;
  scan_type: string;
  photo_bytes: number | null;
  created_at: string;
  url: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ShopSnaps({ tenantId }: { tenantId: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/customer/${tenantId}/photos`)
      .then((r) => r.json())
      .then((d) => {
        setPhotos(d.photos ?? []);
        setTotalBytes(d.totalBytes ?? 0);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function deleteOne(scanId: number) {
    setBusy(true);
    try {
      await fetch(`/api/admin/customer/${tenantId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (!confirm(`Delete all ${photos.length} stored photos for this shop? This clears them from Supabase Storage — can't be undone.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/customer/${tenantId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen((v) => !v)} className="text-white text-sm font-semibold">
          Snaps {open ? '▾' : '▸'}
        </button>
        {open && photos.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40">{photos.length} photos · {formatBytes(totalBytes)}</span>
            <button
              onClick={resetAll}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              Reset all
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-4">
          {loading && <p className="text-white/30 text-sm">Loading…</p>}
          {!loading && photos.length === 0 && <p className="text-white/30 text-sm">No stored photos for this shop.</p>}
          <div className="grid grid-cols-4 gap-3">
            {photos.map((p) => (
              <div key={p.id} className="relative group rounded-lg overflow-hidden border border-white/10 bg-black/20">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.scan_type} className="w-full h-24 object-cover" />
                ) : (
                  <div className="w-full h-24 flex items-center justify-center text-white/20 text-xs">no preview</div>
                )}
                <div className="p-1.5">
                  <p className="text-[10px] text-white/50">{p.scan_type} · {p.photo_bytes ? formatBytes(p.photo_bytes) : '—'}</p>
                  <p className="text-[10px] text-white/30">{new Date(p.created_at).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={() => deleteOne(p.id)}
                  disabled={busy}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/80 text-white text-[10px] px-1.5 py-0.5 rounded disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
