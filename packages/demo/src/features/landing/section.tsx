import type { ReactNode } from 'react';

/** A landing page band. Markdown children are styled as prose. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-ink-800 last:border-b-0">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>
        <div className="prose prose-invert max-w-none prose-a:text-accent prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:p-0">
          {children}
        </div>
      </div>
    </section>
  );
}
