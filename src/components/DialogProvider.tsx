'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { colors } from '@/lib/theme';

type DialogRequest =
  | { kind: 'alert'; message: string; resolve: () => void }
  | { kind: 'confirm'; message: string; resolve: (ok: boolean) => void };

interface DialogContextValue {
  alert: (message: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

// Mounted once in the root layout. Replaces window.alert()/window.confirm()
// — those render as a native browser dialog prefixed with the page's
// origin ("localhost says…" in dev), which looks broken/unprofessional and
// can't be styled at all.
export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const alert = useCallback((message: string) => {
    return new Promise<void>((resolve) => {
      setRequest({ kind: 'alert', message, resolve });
    });
  }, []);

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ kind: 'confirm', message, resolve });
    });
  }, []);

  function close(result?: boolean) {
    if (!request) return;
    if (request.kind === 'alert') request.resolve();
    else request.resolve(!!result);
    setRequest(null);
  }

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {request && (
        <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 px-5 pb-8 sm:items-center" onClick={() => request.kind === 'alert' && close()}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
          >
            <p className="text-sm text-foreground whitespace-pre-line">{request.message}</p>
            <div className="mt-5 flex gap-2">
              {request.kind === 'confirm' && (
                <button
                  onClick={() => close(false)}
                  className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-sub"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => close(true)}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ backgroundColor: colors.home }}
              >
                {request.kind === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
