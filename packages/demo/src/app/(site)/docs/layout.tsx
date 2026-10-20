import type { ReactNode } from 'react';
import { DocsPager } from '@/features/docs/docs-pager';
import { DocsSidebar } from '@/features/docs/docs-sidebar';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <DocsSidebar />
      <main className="min-w-0">
        <article className="prose prose-invert max-w-3xl prose-headings:scroll-mt-20 prose-a:text-accent prose-code:before:content-none prose-code:after:content-none prose-pre:bg-transparent prose-pre:p-0">
          {children}
        </article>
        <DocsPager />
      </main>
    </div>
  );
}
