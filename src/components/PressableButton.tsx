'use client';

import React from 'react';
import OrbitInline from './OrbitInline';

interface PressableButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  loading?: boolean;
  loadingColor?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

// Drop-in replacement for a plain <button> that adds:
//  1. A tactile press-down effect (scale + slight opacity dip) so taps feel
//     registered immediately — addresses the "is this clicking or not"
//     confusion, independent of how long the actual request takes.
//  2. An optional `loading` prop that swaps the button's content for the
//     orbit spinner and disables further taps, so a slow request never
//     looks identical to a dead button.
//
// Visual feedback (the press effect) is instant and CSS-only — it never
// waits on the loading prop, so taps always feel responsive even before
// a network request has had a chance to start.
export default function PressableButton({
  loading = false,
  loadingColor = '#ffffff',
  className = '',
  style,
  children,
  disabled,
  ...props
}: PressableButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`press-feedback ${className}`}
      style={style}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <OrbitInline size={18} color={loadingColor} />
          <span className="opacity-80">Working…</span>
        </span>
      ) : (
        children
      )}

      <style jsx>{`
        .press-feedback {
          transition: transform 110ms ease, opacity 110ms ease;
        }
        .press-feedback:active:not(:disabled) {
          transform: scale(0.96);
          opacity: 0.85;
        }
      `}</style>
    </button>
  );
}
