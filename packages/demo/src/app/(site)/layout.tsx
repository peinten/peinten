import type { ReactNode } from 'react';
import { SiteFooter } from '@/features/site/site-footer';
import { SiteHeader } from '@/features/site/site-header';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col text-base">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
