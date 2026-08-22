'use client';

import React, { useEffect } from 'react';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  // Lock body scroll while the sheet is open (web equivalent of the RN
  // Modal's natural behavior of covering the screen).
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="sheet-slide-up relative max-h-[85%] overflow-hidden rounded-t-[28px] bg-white px-[22px]">
        <div className="mx-auto my-3 h-1 w-10 rounded-full bg-border" />
        <div className="max-h-[calc(85vh-40px)] overflow-y-auto pb-9">{children}</div>
      </div>
    </div>
  );
}
