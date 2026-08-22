'use client';

import { useId } from 'react';

// Gooey orbiting-drops loading spinner — adapted from the user-provided
// reference animation. Pure CSS (no JS animation loop), so it's cheap to
// mount/unmount anywhere we need to show "something is happening" instead
// of a static spinner or nothing at all.
//
// `color` lets each screen tint the drops — usually the tenant's brand
// color (colors.home) so the loader matches whatever they picked in
// Settings, rather than always being purple.

interface LoadingOrbitProps {
  size?: number; // outer container size in px
  color?: string;
  label?: string;
  sublabel?: string;
  light?: boolean; // true = light-colored text, for use on dark backgrounds
}

export default function LoadingOrbit({ size = 64, color = '#9333ea', label, sublabel, light = false }: LoadingOrbitProps) {
  // Scale every measurement off the base 120px design so the geometry
  // (drop size, translate distances) stays proportionally correct at any
  // requested size instead of just shrinking the container and clipping.
  const scale = size / 120;
  const dropSize = 28 * scale;
  const dropOffset = dropSize / 2;
  const topDistance = 42 * scale;
  const diagX = 36.3 * scale;
  const diagY = 21 * scale;
  // Must be a valid SVG id / url(#...) reference. `color` is often
  // `colors.home`, which resolves to `var(--color-home, #6C63FF)` — not a
  // plain hex — so it can contain spaces, parens, and commas. Deriving the
  // id from that string (as this used to) produces an invalid id and a
  // broken `url(#...)` filter reference. useId() is always a clean,
  // stable, unique id regardless of what color value gets passed in.
  const reactId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const filterId = `goo-fluid-${reactId}`;

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          animation: 'orbit-rotate 2s linear infinite',
          filter: `url(#${filterId})`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              backgroundColor: color,
              width: dropSize,
              height: dropSize,
              top: '50%',
              left: '50%',
              marginTop: -dropOffset,
              marginLeft: -dropOffset,
              animation: `orbit-flow-${i} 0.5s ease-in-out infinite alternate`,
              ['--orbit-top-dist' as string]: `${topDistance}px`,
              ['--orbit-diag-x' as string]: `${diagX}px`,
              ['--orbit-diag-y' as string]: `${diagY}px`,
            }}
          />
        ))}
      </div>

      {(label || sublabel) && (
        <div className="text-center">
          {label && (
            <p className={`text-sm font-semibold ${light ? 'text-white' : 'text-foreground'}`}>{label}</p>
          )}
          {sublabel && (
            <p className={`mt-0.5 text-xs ${light ? 'text-white/60' : 'text-sub'}`}>{sublabel}</p>
          )}
        </div>
      )}

      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>

      <style jsx>{`
        @keyframes orbit-rotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(720deg); }
        }
        @keyframes orbit-flow-0 {
          0% { transform: translate(0, calc(-1 * var(--orbit-top-dist))) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
        @keyframes orbit-flow-1 {
          0% { transform: translate(var(--orbit-diag-x), var(--orbit-diag-y)) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
        @keyframes orbit-flow-2 {
          0% { transform: translate(calc(-1 * var(--orbit-diag-x)), var(--orbit-diag-y)) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
      `}</style>
    </div>
  );
}
