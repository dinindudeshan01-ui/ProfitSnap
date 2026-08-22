// Direct port of src/components/UnitIcon.js — identical SVG path data,
// just translated from react-native-svg's <Svg>/<Path> to plain web <svg>.

import { unitColor } from '@/lib/theme';

const STROKE_PROPS = {
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

interface IconProps {
  color: string;
  size: number;
}

function PcsIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" stroke={color} {...STROKE_PROPS} />
      <path d="M3 8v8l9 5 9-5V8" stroke={color} {...STROKE_PROPS} />
      <line x1="12" y1="13" x2="12" y2="21" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function ScaleIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <line x1="12" y1="3" x2="12" y2="6" stroke={color} {...STROKE_PROPS} />
      <line x1="5" y1="7" x2="19" y2="7" stroke={color} {...STROKE_PROPS} />
      <path d="M5 7l-3 7a3 3 0 0 0 6 0l-3-7z" stroke={color} {...STROKE_PROPS} />
      <path d="M19 7l-3 7a3 3 0 0 0 6 0l-3-7z" stroke={color} {...STROKE_PROPS} />
      <line x1="8" y1="21" x2="16" y2="21" stroke={color} {...STROKE_PROPS} />
      <line x1="12" y1="10" x2="12" y2="21" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function DropletIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function RulerIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M3 16l5-5 12 12-5 5z" stroke={color} {...STROKE_PROPS} />
      <line x1="14" y1="8" x2="16" y2="10" stroke={color} {...STROKE_PROPS} />
      <line x1="17" y1="5" x2="19" y2="7" stroke={color} {...STROKE_PROPS} />
      <line x1="11" y1="11" x2="13" y2="13" stroke={color} {...STROKE_PROPS} />
      <line x1="8" y1="14" x2="10" y2="16" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function PacketIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="4" y="7" width="16" height="13" rx="2" stroke={color} {...STROKE_PROPS} />
      <line x1="4" y1="11" x2="20" y2="11" stroke={color} {...STROKE_PROPS} />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function BoxIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="3" y="9" width="18" height="11" rx="1.5" stroke={color} {...STROKE_PROPS} />
      <path d="M3 9l2-5h14l2 5" stroke={color} {...STROKE_PROPS} />
      <line x1="10" y1="13" x2="14" y2="13" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function PairIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 4l8 4-8 4-8-4 8-4z" stroke={color} {...STROKE_PROPS} />
      <path d="M4 13l8 4 8-4" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function SetIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" stroke={color} {...STROKE_PROPS} />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" stroke={color} {...STROKE_PROPS} />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" stroke={color} {...STROKE_PROPS} />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function DozenIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" stroke={color} {...STROKE_PROPS} />
      <circle cx="12" cy="4.5" r="1.4" stroke={color} {...STROKE_PROPS} />
      <circle cx="18.5" cy="8.2" r="1.4" stroke={color} {...STROKE_PROPS} />
      <circle cx="18.5" cy="15.8" r="1.4" stroke={color} {...STROKE_PROPS} />
      <circle cx="12" cy="19.5" r="1.4" stroke={color} {...STROKE_PROPS} />
      <circle cx="5.5" cy="15.8" r="1.4" stroke={color} {...STROKE_PROPS} />
      <circle cx="5.5" cy="8.2" r="1.4" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function BagIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" stroke={color} {...STROKE_PROPS} />
      <line x1="3" y1="6" x2="21" y2="6" stroke={color} {...STROKE_PROPS} />
      <path d="M16 10a4 4 0 0 1-8 0" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

function GenericIcon({ color, size }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke={color} {...STROKE_PROPS} />
    </svg>
  );
}

const ICONS_BY_UNIT: Record<string, React.ComponentType<IconProps>> = {
  pcs: PcsIcon,
  kg: ScaleIcon,
  g: ScaleIcon,
  L: DropletIcon,
  ml: DropletIcon,
  m: RulerIcon,
  packet: PacketIcon,
  box: BoxIcon,
  pair: PairIcon,
  set: SetIcon,
  dozen: DozenIcon,
  bag: BagIcon,
};

interface UnitIconProps {
  unit: string;
  color?: string;
  size?: number;
}

// Usage: <UnitIcon unit="kg" size={18} /> — color defaults to the unit's
// accent color from lib/theme, but can be overridden.
export default function UnitIcon({ unit, color, size = 18 }: UnitIconProps) {
  const IconComponent = ICONS_BY_UNIT[unit] || GenericIcon;
  const resolvedColor = color || unitColor(unit);
  return <IconComponent color={resolvedColor} size={size} />;
}
