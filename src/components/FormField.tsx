import React from 'react';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  containerClassName?: string;
}

export default function FormField({ label, containerClassName, className, ...inputProps }: FormFieldProps) {
  return (
    <div className={`mb-3.5 ${containerClassName || ''}`}>
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-sub">
        {label}
      </label>
      <input
        className={`w-full rounded-xl bg-bg px-3.5 py-3 text-[15px] text-foreground outline-none focus:ring-2 focus:ring-home/40 ${className || ''}`}
        {...inputProps}
      />
    </div>
  );
}
