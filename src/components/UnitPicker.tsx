'use client';

import { unitColor, UNITS } from '@/lib/theme';
import UnitIcon from './UnitIcon';

interface UnitPickerProps {
  label: string;
  value: string;
  onChange: (unit: string) => void;
}

export default function UnitPicker({ label, value, onChange }: UnitPickerProps) {
  return (
    <div className="mb-3.5">
      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-sub">
        {label}
      </label>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pr-2">
        {UNITS.map((u) => {
          const active = value === u;
          const color = unitColor(u);
          return (
            <button
              key={u}
              type="button"
              onClick={() => onChange(u)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border-[1.5px] px-3 py-2"
              style={{
                backgroundColor: active ? `${color}18` : 'var(--background)',
                borderColor: active ? color : 'transparent',
              }}
            >
              <UnitIcon unit={u} size={14} color={active ? color : 'var(--color-sub)'} />
              <span
                className="text-[13px]"
                style={{ color: active ? color : 'var(--color-sub)', fontWeight: active ? 700 : 400 }}
              >
                {u}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
