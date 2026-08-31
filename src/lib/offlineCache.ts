'use client';

const PREFIX = 'profitsnap:cache:';

interface CachedEntry<T> {
  value: T;
  savedAt: number;
}

export function getCached<T>(key: string): CachedEntry<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedEntry<T>;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry<T> = { value, savedAt: Date.now() };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — fine to silently skip.
  }
}

export function formatCacheAge(savedAt: number): string {
  const seconds = Math.floor((Date.now() - savedAt) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
