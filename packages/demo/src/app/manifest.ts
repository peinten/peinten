import type { MetadataRoute } from 'next';
import { BRAND_BACKGROUND, SITE_DESCRIPTION } from '@/features/site/brand';

// Static export only writes route handlers that are static.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'peinten',
    description: SITE_DESCRIPTION,
    start_url: '/demo',
    display: 'standalone',
    background_color: BRAND_BACKGROUND,
    theme_color: BRAND_BACKGROUND,
    icons: [
      { src: '/brand/peinten-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/peinten-icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/peinten-icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
