'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

// Same GeoJSON (lk.json) -> standard English district name mapping as the
// reference component this was adapted from — the raw geojson uses
// diacritic-heavy transliterations that don't match what tenants pick in
// Settings (see src/lib/districts.ts), so this normalizes them.
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

function tier(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 5) return 1;
  if (count <= 15) return 2;
  if (count <= 50) return 3;
  return 4;
}

// Silver/steel-blue tiers — same "premium, keep it mostly black" palette as
// the rest of the admin panel, not the gold KoS uses on its public site.
const TIER_FILL: Record<number, string> = {
  0: 'rgba(200,215,235,0.06)',
  1: 'rgba(111,168,220,0.35)',
  2: 'rgba(111,168,220,0.55)',
  3: 'rgba(111,168,220,0.75)',
  4: 'rgba(90,160,230,0.9)',
};
const TIER_STROKE: Record<number, string> = {
  0: 'rgba(200,215,235,0.15)',
  1: 'rgba(111,168,220,0.5)',
  2: 'rgba(111,168,220,0.65)',
  3: 'rgba(111,168,220,0.85)',
  4: 'rgba(90,160,230,0.95)',
};

type DistrictPath = { name: string; d: string; centroid: [number, number] };

function DistrictSvg({
  countMap,
  issueDistricts,
  selectedDistrict,
  onDistrictClick,
}: {
  countMap: Record<string, number>;
  issueDistricts: Set<string>;
  selectedDistrict: string;
  onDistrictClick: (d: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<DistrictPath[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; count: number; hasIssue: boolean } | null>(null);

  useEffect(() => {
    fetch('/lk.json')
      .then((r) => r.json())
      .then((geo) => {
        const proj = d3.geoMercator().fitSize([260, 440], geo);
        const pathGen = d3.geoPath().projection(proj);
        setPaths(
          geo.features.map((f: GeoJSON.Feature) => ({
            name: normName((f.properties as { name?: string })?.name ?? ''),
            d: pathGen(f) ?? '',
            centroid: pathGen.centroid(f as never) as [number, number],
          }))
        );
      })
      .catch(() => setPaths([]));
  }, []);

  function onMouseMove(e: React.MouseEvent<SVGPathElement>, name: string) {
    const rect = svgRef.current?.getBoundingClientRect();
    setTooltip({
      x: (rect ? e.clientX - rect.left : 0) + 10,
      y: (rect ? e.clientY - rect.top : 0) - 8,
      name,
      count: countMap[name] ?? 0,
      hasIssue: issueDistricts.has(name),
    });
    setHovered(name);
  }

  return (
    <div className="relative w-full h-full">
      <svg ref={svgRef} viewBox="0 0 260 440" className="w-full h-full block">
        {paths.map(({ name, d, centroid }) => {
          const count = countMap[name] ?? 0;
          const hasIssue = issueDistricts.has(name);
          const isHov = hovered === name;
          const isSel = selectedDistrict === name;
          const fill = isSel
            ? 'rgba(200,213,224,0.85)'
            : hasIssue
            ? 'rgba(239,68,68,0.55)'
            : isHov
            ? 'rgba(90,160,230,0.55)'
            : TIER_FILL[tier(count)];
          const stroke = isSel
            ? 'rgba(200,213,224,0.9)'
            : hasIssue
            ? 'rgba(239,68,68,0.9)'
            : isHov
            ? 'rgba(90,160,230,0.6)'
            : TIER_STROKE[tier(count)];
          return (
            <g key={name}>
              <path
                d={d}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSel ? 1.5 : hasIssue ? 1.4 : isHov ? 1.2 : count > 0 ? 0.9 : 0.5}
                className="cursor-pointer transition-colors duration-150"
                onClick={() => onDistrictClick(isSel ? '' : name)}
                onMouseMove={(e) => onMouseMove(e, name)}
                onMouseLeave={() => {
                  setHovered(null);
                  setTooltip(null);
                }}
              />
              {count > 0 && centroid[0] > 0 && (
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="7.5"
                  fontWeight="700"
                  fill="rgba(240,242,246,0.95)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="absolute z-30 pointer-events-none bg-[rgba(9,11,22,0.96)] border border-white/10 rounded-lg px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="text-xs font-bold text-white">{tooltip.name}</div>
          <div className="text-[11px] text-[#6FA8DC] mt-0.5">
            {tooltip.count} shop{tooltip.count !== 1 ? 's' : ''}
          </div>
          {tooltip.hasIssue && <div className="text-[11px] text-red-400 mt-0.5">⚠ Needs attention</div>}
        </div>
      )}
    </div>
  );
}

export default function TenantDistrictMap({
  districtCounts,
  issueDistricts = [],
  selectedDistrict,
  onDistrictClick,
}: {
  districtCounts: Record<string, number>;
  issueDistricts?: string[];
  selectedDistrict: string;
  onDistrictClick: (d: string) => void;
}) {
  const sorted = Object.entries(districtCounts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 1;
  const top8 = sorted.slice(0, 8);
  const issueSet = new Set(issueDistricts);

  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-white/80">Shops by District</p>
          <p className="text-[10px] text-white/30 mt-0.5">
            Based on each shop&apos;s self-reported district in Settings — click to filter below
          </p>
        </div>
        {selectedDistrict && (
          <button
            onClick={() => onDistrictClick('')}
            className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-white/50 hover:text-white/80 transition"
          >
            ✕ Clear
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {(
          [
            [1, TIER_FILL[1], '1 – 5'],
            [2, TIER_FILL[2], '6 – 15'],
            [3, TIER_FILL[3], '16 – 50'],
            [4, TIER_FILL[4], '50+'],
          ] as [number, string, string][]
        ).map(([t, color, label]) => (
          <div key={t} className="flex items-center gap-2">
            <div className="w-7 h-2 rounded-sm flex-shrink-0" style={{ background: color }}></div>
            <span className="text-[10px] text-white/45">{label} shops</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-7 h-2 rounded-sm flex-shrink-0" style={{ background: 'rgba(239,68,68,0.55)' }}></div>
          <span className="text-[10px] text-white/45">Has an unresolved report or refund</span>
        </div>
      </div>

      <div className="h-[360px]">
        <DistrictSvg
          countMap={districtCounts}
          issueDistricts={issueSet}
          selectedDistrict={selectedDistrict}
          onDistrictClick={onDistrictClick}
        />
      </div>

      <div>
        <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-2.5">Top Districts</p>
        <div className="flex flex-col gap-1.5">
          {top8.length === 0 ? (
            <p className="text-xs text-white/20">No shops with a district set yet.</p>
          ) : (
            top8.map(([name, count], i) => {
              const pct = Math.round((count / max) * 100);
              const isSel = selectedDistrict === name;
              const hasIssue = issueSet.has(name);
              return (
                <div
                  key={name}
                  onClick={() => onDistrictClick(isSel ? '' : name)}
                  className={`cursor-pointer rounded-lg px-2.5 py-1.5 border transition ${
                    isSel
                      ? 'bg-[#6FA8DC]/10 border-[#6FA8DC]/30'
                      : hasIssue
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-white/[0.02] border-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-white/20 min-w-[14px]">#{i + 1}</span>
                      {hasIssue && <span className="text-red-400 text-[10px]">⚠</span>}
                      <span className={`text-[11px] font-semibold ${isSel ? 'text-[#6FA8DC]' : hasIssue ? 'text-red-400' : 'text-white/70'}`}>{name}</span>
                    </div>
                    <span className="text-[11px] font-bold text-[#6FA8DC]">{count}</span>
                  </div>
                  <div className="h-[3px] bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full bg-[#6FA8DC]/50 rounded-full" style={{ width: `${pct}%` }}></div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
