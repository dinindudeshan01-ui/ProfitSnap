'use client';

// Compact version of LoadingOrbit sized to sit inline inside a button
// (next to label text) rather than as a standalone centered loader. Same
// animation, just small and with no label slot.

const SHARED_FILTER_ID = 'goo-fluid-inline';

interface OrbitInlineProps {
  size?: number;
  color?: string;
}

export default function OrbitInline({ size = 20, color = '#ffffff' }: OrbitInlineProps) {
  const scale = size / 120;
  const dropSize = Math.max(6, 28 * scale);
  const dropOffset = dropSize / 2;
  const topDistance = 42 * scale;
  const diagX = 36.3 * scale;
  const diagY = 21 * scale;

  return (
    <span
      className="relative inline-block shrink-0"
      style={{
        width: size,
        height: size,
        animation: 'orbit-rotate-inline 2s linear infinite',
        filter: `url(#${SHARED_FILTER_ID})`,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
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
            animation: `orbit-flow-inline-${i} 0.5s ease-in-out infinite alternate`,
            ['--orbit-top-dist' as string]: `${topDistance}px`,
            ['--orbit-diag-x' as string]: `${diagX}px`,
            ['--orbit-diag-y' as string]: `${diagY}px`,
          }}
        />
      ))}

      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id={SHARED_FILTER_ID}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
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
        @keyframes orbit-rotate-inline {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(720deg); }
        }
        @keyframes orbit-flow-inline-0 {
          0% { transform: translate(0, calc(-1 * var(--orbit-top-dist))) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
        @keyframes orbit-flow-inline-1 {
          0% { transform: translate(var(--orbit-diag-x), var(--orbit-diag-y)) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
        @keyframes orbit-flow-inline-2 {
          0% { transform: translate(calc(-1 * var(--orbit-diag-x)), var(--orbit-diag-y)) scale(0.85); }
          100% { transform: translate(0, 0) scale(1.4); }
        }
      `}</style>
    </span>
  );
}
