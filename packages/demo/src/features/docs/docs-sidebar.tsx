'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from './nav';

function NavList() {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      {DOCS_NAV.map((group) => (
        <div key={group.section}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{group.section}</p>
          <ul className="space-y-1">
            {group.pages.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className={`block rounded px-2 py-1 text-sm ${
                    pathname === page.href ? 'bg-accent/15 text-white' : 'text-ink-400 hover:text-ink-200'
                  }`}
                >
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Docs navigation: a sticky column on wide screens, a collapsible menu on phones. */
export function DocsSidebar() {
  return (
    <>
      <details className="rounded-lg border border-ink-800 p-3 lg:hidden">
        <summary className="cursor-pointer text-sm text-ink-200">Contents</summary>
        <div className="mt-4">
          <NavList />
        </div>
      </details>
      <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] overflow-y-auto lg:block">
        <NavList />
      </aside>
    </>
  );
}
