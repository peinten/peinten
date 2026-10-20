'use client';
import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

/** Centered dialog with a title, used for small forms. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ink-700 bg-ink-900 p-4 shadow-2xl outline-none">
          <Dialog.Title className="mb-3 font-semibold text-ink-200">{title}</Dialog.Title>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
