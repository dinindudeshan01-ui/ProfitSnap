'use client';

import { ArrowLeft } from 'lucide-react';

interface ArcHeaderProps {
  title: string;
  subtitle?: string;
  color: string;
  onBack?: () => void;
}

// gradientColor note from the original kept for continuity: this uses a
// flat color rather than a true gradient, matching the RN version's choice.
export default function ArcHeader({ title, subtitle, color, onBack }: ArcHeaderProps) {
  return (
    <div className="relative overflow-hidden px-6 pb-11 pt-5" style={{ backgroundColor: color }}>
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-5 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/25"
          aria-label="Back"
        >
          <ArrowLeft size={18} color="white" strokeWidth={2.5} />
        </button>
      )}
      <div className={onBack ? 'pl-11' : ''}>
        <h1 className="text-[26px] font-bold tracking-tight text-white">{title}</h1>
{subtitle ? <p className="mt-1 text-sm text-white/80" suppressHydrationWarning>{subtitle}</p> : null}      </div>
      <div
        className="absolute -bottom-10 left-[-10%] h-20 w-[120%] rounded-full"
        style={{ backgroundColor: 'var(--background)' }}
      />
    </div>
  );
}
