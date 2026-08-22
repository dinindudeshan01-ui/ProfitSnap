'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingCart, Boxes, BarChart3, ShoppingBag, HandCoins } from 'lucide-react';
import { useLang } from '@/lib/i18n/LangContext';

const TABS = [
  { href: '/', Icon: Home, labelKey: 'navHome' },
  { href: '/sales', Icon: ShoppingCart, labelKey: 'navSales' },
  { href: '/stock', Icon: Boxes, labelKey: 'navStock' },
  { href: '/credit-sales', Icon: HandCoins, labelKey: 'navCredit' },
  { href: '/profit', Icon: BarChart3, labelKey: 'navProfit' },
  { href: '/items', Icon: ShoppingBag, labelKey: 'navItems' },
];

export default function BottomTabBar() {
  const pathname = usePathname();
  const { t } = useLang();

  return (
    <nav className="flex border-t border-border bg-white pt-1.5">
      {TABS.map(({ href, Icon, labelKey }) => {
        const active = pathname === href;
        const color = active ? 'var(--color-home)' : 'var(--color-sub)';
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
          >
            <Icon size={20} color={color} strokeWidth={2} />
            <span className="text-[10px] font-medium" style={{ color }}>
              {t[labelKey] || href}
            </span>
            <span
              className="mt-0.5 h-1 w-1 rounded-full"
              style={{ backgroundColor: 'var(--color-home)', opacity: active ? 1 : 0 }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
