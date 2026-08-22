'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const SHOW_DELAY_MS = 150;
const MIN_VISIBLE_MS = 220;

export default function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const prevPathname = useRef(pathname);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number>(0);

  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;

    if (showTimer.current) clearTimeout(showTimer.current);

    if (visible) {
      const elapsed = Date.now() - shownAt.current;
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), remaining);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    function armShowTimer() {
      if (showTimer.current) clearTimeout(showTimer.current);
      showTimer.current = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY_MS);
    }

    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!target) return;
      if (target.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = target.getAttribute('href') || '';
      if (href.startsWith('http') || href.startsWith('#')) return;
      armShowTimer();
    }

    function onPopState() {
      armShowTimer();
    }

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-50 h-[3px] w-full overflow-hidden"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 120ms ease' }}
    >
      <div
        className="h-full"
        style={{
          width: visible ? '70%' : '0%',
          background: 'linear-gradient(90deg, var(--color-home), var(--color-stock))',
          transition: visible
            ? 'width 1.6s cubic-bezier(0.15, 0.8, 0.3, 1)'
            : 'width 150ms ease, opacity 150ms ease',
          borderRadius: '0 4px 4px 0',
        }}
      />
    </div>
  );
}