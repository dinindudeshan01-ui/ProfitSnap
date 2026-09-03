'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { colors } from '@/lib/theme';

// Same raw-geojson -> standard English district name mapping used by
// src/components/admin/TenantDistrictMap.tsx — kept in sync with
// src/lib/districts.ts so whatever the person picks here matches exactly
// what Settings expects.
const NAME_MAP: Record<string, string> = {
  'Kŏḷamba': 'Colombo',
  Gampaha: 'Gampaha',
  'Kaḷutara': 'Kalutara',
  Mahanuvara: 'Kandy',
  'Mātale': 'Matale',
  'Nuvara Ĕliya': 'Nuwara Eliya',
  'Gālla': 'Galle',
  'Mātara': 'Matara',
  'Hambantŏṭa': 'Hambantota',
  'Yāpanaya': 'Jaffna',
  'Kilinŏchchi': 'Kilinochchi',
  'Mannārama': 'Mannar',
  'Vavuniyāva': 'Vavuniya',
  Mulativ: 'Mullaitivu',
  'Maḍakalapuva': 'Batticaloa',
  'Ampāra': 'Ampara',
  'Trikuṇāmalaya': 'Trincomalee',
  'Kuruṇægala': 'Kurunegala',
  Puttalama: 'Puttalam',
  'Anurādhapura': 'Anuradhapura',
  'Pŏḷŏnnaruva': 'Polonnaruwa',
  Badulla: 'Badulla',
  'Mŏṇarāgala': 'Monaragala',
  Ratnapura: 'Ratnapura',
  'Kægalla': 'Kegalle',
};

function normName(raw: string): string {
  return NAME_MAP[raw] ?? raw;
}

type DistrictPath = { name: string; d: string; centroid: [number, number] };

// Fixed size, tuned to be legible without dominating a mobile screen —
// tap a shape rather than a dropdown, but small enough to see the whole
// country at once with the district names readable.
const VB_W = 300;
const VB_H = 520;

export default function DistrictPickerMap({
  value,
  onChange,
}: {
  value: string;
  onChange: (district: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<DistrictPath[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);

  useEffect(() => {
    fetch('/lk.json')
      .then((r) => r.json())
      .then((geo) => {
        const proj = d3.geoMercator().fitSize([VB_W - 16, VB_H - 16], geo);
        const pathGen = d3.geoPath().projection(proj);
        setPaths(
          geo.features.map((f: GeoJSON.Feature) => ({
            name: normName((f.properties as { name?: string })?.name ?? ''),
            d: pathGen(f) ?? '',
            centroid: pathGen.centroid(f as never) as [number, number],
          }))
        );
      })
      .catch(() => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <div className="rounded-xl border border-border bg-white/50 p-4 text-center text-sm text-sub">
        Couldn&apos;t load the map. You can still type your district below.
      </div>
    );
  }

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="mx-auto block w-full max-w-[280px]"
        style={{ transform: 'translate(8px, 8px)' }}
      >
        {paths.map(({ name, d, centroid }) => {
          const isSel = value === name;
          const isPressed = pressed === name;
          return (
            <g key={name}>
              <path
                d={d}
                fill={isSel ? colors.home : isPressed ? `${colors.home}55` : '#E9EBF0'}
                stroke={isSel ? colors.home : '#C7CBD4'}
                strokeWidth={isSel ? 1.2 : 0.6}
                className="cursor-pointer transition-colors duration-100"
                onPointerDown={() => setPressed(name)}
                onPointerUp={() => setPressed(null)}
                onPointerLeave={() => setPressed(null)}
                onClick={() => onChange(isSel ? '' : name)}
              />
              {centroid[0] > 0 && (
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="5.2"
                  fontWeight={isSel ? 700 : 500}
                  fill={isSel ? '#FFFFFF' : '#5B6270'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-center text-xs text-sub">
        {value ? (
          <>
            Selected: <span className="font-semibold text-foreground">{value}</span>
          </>
        ) : (
          'Tap your district on the map'
        )}
      </p>
    </div>
  );
}
