import {
  Blend,
  Brush,
  FileDown,
  Layers,
  type LucideIcon,
  MousePointer2,
  SlidersHorizontal,
  Type,
  Users,
} from 'lucide-react';
import Link from 'next/link';

const FEATURES: readonly { icon: LucideIcon; title: string; text: string; href: string }[] = [
  {
    icon: Brush,
    title: 'libmypaint brushes',
    text: 'Load .myb files. Pressure, tilt, barrel rotation, smudge and spectral pigment mixing.',
    href: '/docs/brushes',
  },
  {
    icon: Layers,
    title: 'Layers and folders',
    text: 'Paint, folder, adjustment and text layers with 26 blend modes and pass-through.',
    href: '/docs/editing',
  },
  {
    icon: MousePointer2,
    title: 'Selections and transform',
    text: 'Marquee, lasso, polygon, magic wand, quick mask. Affine, perspective and mesh warps.',
    href: '/docs/selections-and-transform',
  },
  {
    icon: SlidersHorizontal,
    title: 'WGSL filters',
    text: 'Destructive or as adjustment layers, from one deterministic integer kernel.',
    href: '/docs/filters',
  },
  {
    icon: Type,
    title: 'Text layers',
    text: 'Per-range styles, point and area text, vertical writing. Editable after affine transforms.',
    href: '/docs/text',
  },
  {
    icon: Users,
    title: 'Collaboration',
    text: 'A sequencer orders operations; every peer recomputes strokes from their samples.',
    href: '/docs/collaboration',
  },
  {
    icon: FileDown,
    title: 'Files',
    text: 'Save as CBOR, export PNG, JPEG and layered PSD with text.',
    href: '/docs/files',
  },
  {
    icon: Blend,
    title: 'Any UI framework',
    text: 'Synchronous snapshots that keep identity. React, Vue, Svelte and Solid fit in a few lines.',
    href: '/docs/ui-state',
  },
];

/** The feature overview of the landing page; each card links to its docs page. */
export function FeatureGrid() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map(({ icon: Icon, title, text, href }) => (
        <Link
          key={title}
          href={href}
          className="rounded-lg border border-ink-800 bg-ink-900 p-5 transition-colors hover:border-ink-600"
        >
          <Icon className="mb-3 size-5 text-accent" aria-hidden="true" />
          <h3 className="mb-1 font-medium text-white">{title}</h3>
          <p className="text-sm text-ink-400">{text}</p>
        </Link>
      ))}
    </div>
  );
}
