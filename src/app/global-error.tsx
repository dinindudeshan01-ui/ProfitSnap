'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled app error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex h-screen items-center justify-center bg-[#F2F4F8] px-8">
        <div className="max-w-sm text-center">
          <h2 className="mb-2 text-lg font-bold text-[#1A1A2E]">Something went wrong</h2>
          <p className="mb-5 text-sm text-[#6B7280]">
            {error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={reset}
            className="rounded-xl bg-[#6C63FF] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
