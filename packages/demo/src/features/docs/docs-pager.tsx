'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_PAGES } from './nav';

/** Links to the previous and next page in reading order. */
export function DocsPager() {
  const pathname = usePathname();
  const index = DOCS_PAGES.findIndex((page) => page.href === pathname);
  const previous = DOCS_PAGES[index - 1];
  const next = DOCS_PAGES[index + 1];
  return (
    <nav className="mt-16 flex justify-between gap-4 border-t border-ink-800 pt-6 text-sm">
      {previous ? (
        <Link href={previous.href} className="text-ink-400 hover:text-ink-200">
          ← {previous.title}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="text-ink-400 hover:text-ink-200">
          {next.title} →
        </Link>
      )}
    </nav>
  );
}
