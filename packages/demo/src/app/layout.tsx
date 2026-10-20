import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRAND_BACKGROUND, SITE_DESCRIPTION } from '@/features/site/brand';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://peinten.vercel.app'),
  title: 'peinten — painting engine for web apps',
  description: SITE_DESCRIPTION,
  openGraph: { type: 'website', siteName: 'peinten', description: SITE_DESCRIPTION },
  twitter: { card: 'summary_large_image' },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/brand/peinten-icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/brand/peinten-apple-touch-icon.png',
  },
};

export const viewport: Viewport = { themeColor: BRAND_BACKGROUND };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-sm antialiased">{children}</body>
    </html>
  );
}
