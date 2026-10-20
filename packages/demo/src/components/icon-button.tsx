import type { ReactNode } from 'react';

/** Small square button showing an icon, with the label as tooltip and accessible name. */
export function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-ink-200 ${active ? 'bg-ink-800 text-ink-200' : ''}`}
    >
      {children}
    </button>
  );
}
