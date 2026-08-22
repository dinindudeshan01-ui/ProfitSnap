'use client';

interface DataLoadErrorProps {
  message: string;
  onRetry: () => void;
  accentColor?: string;
}

// Shown by any screen when its Supabase load() call fails — keeps the
// failure mode visible and actionable instead of letting it surface as an
// unhandled promise rejection (which crashes the Next.js dev overlay with
// "[object Object]" when the thrown value isn't a real Error instance).
export default function DataLoadError({ message, onRetry, accentColor = '#6C63FF' }: DataLoadErrorProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center">
      <h2 className="mb-2 text-lg font-bold text-foreground">Can&apos;t reach the database</h2>
      <p className="mb-1 text-sm text-sub">{message}</p>
      <p className="mb-5 text-xs text-sub">
        Check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local point to a
        real Supabase project, and that supabase/schema.sql has been run.
      </p>
      <button
        onClick={onRetry}
        className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
        style={{ backgroundColor: accentColor }}
      >
        Try again
      </button>
    </div>
  );
}
