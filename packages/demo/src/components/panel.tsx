import type { ReactNode } from 'react';

/** Section of the editor sidebar with a title bar and optional actions. */
export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-ink-900">
      <header className="flex h-8 items-center justify-between border-b border-ink-800 px-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {title}
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
