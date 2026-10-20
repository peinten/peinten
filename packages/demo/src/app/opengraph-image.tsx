import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND_BACKGROUND } from '@/features/site/brand';

// Static export renders the image once at build time.
export const dynamic = 'force-static';
export const alt = 'peinten: real painting for your web app';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The link preview shown when the site is shared. */
export default async function OpenGraphImage() {
  const icon = await readFile(join(process.cwd(), 'public/brand/peinten-icon.svg'));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 64,
        padding: '0 96px',
        background: BRAND_BACKGROUND,
        color: '#c9ced8',
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: ImageResponse renders plain elements; next/image does not apply */}
      <img src={`data:image/svg+xml;base64,${icon.toString('base64')}`} width={240} height={240} alt="" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ fontSize: 88, fontWeight: 700, color: '#ffffff' }}>peinten</div>
        <div style={{ fontSize: 44, color: '#ffffff' }}>Real painting for your web app</div>
        <div style={{ fontSize: 30, color: '#7d8697' }}>libmypaint brushes · layers · masks · WebGPU</div>
      </div>
    </div>,
    size,
  );
}
