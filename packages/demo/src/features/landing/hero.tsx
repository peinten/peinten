import Image from 'next/image';
import Link from 'next/link';

/** Brush-like strokes behind the headline, drawn with SVG so the page needs no WebGPU to look right. */
function Strokes() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-60"
      viewBox="0 0 1200 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hero-a" x1="0" x2="1">
          <stop offset="0" stopColor="#6d8cff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#6d8cff" />
          <stop offset="1" stopColor="#c86dff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hero-b" x1="0" x2="1">
          <stop offset="0" stopColor="#ff8a5c" stopOpacity="0" />
          <stop offset="0.6" stopColor="#ff8a5c" />
          <stop offset="1" stopColor="#ffd35c" stopOpacity="0" />
        </linearGradient>
        <filter id="hero-soft">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path
        d="M-40 420 C 220 260, 420 520, 700 360 S 1100 180, 1260 300"
        fill="none"
        stroke="url(#hero-a)"
        strokeWidth="46"
        strokeLinecap="round"
        filter="url(#hero-soft)"
      />
      <path
        d="M-20 180 C 260 120, 380 300, 640 240 S 1000 80, 1240 160"
        fill="none"
        stroke="url(#hero-b)"
        strokeWidth="18"
        strokeLinecap="round"
        filter="url(#hero-soft)"
      />
    </svg>
  );
}

/** Headline and calls to action of the landing page. */
export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-ink-800">
      <Strokes />
      <div className="relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
        <Image
          src="/brand/peinten-icon.svg"
          alt=""
          width={512}
          height={512}
          preload
          className="mb-8 size-16 sm:size-20"
        />
        <p className="mb-4 text-sm font-medium tracking-wide text-accent">Pure TypeScript · WebGPU · libmypaint</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
          Real painting for your web app
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-ink-200">
          Let users paint on images, draw masks and sketch with libmypaint brushes. Layers, selections, undo and live
          collaboration come with the engine; you bring the UI.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/demo" className="rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent/90">
            Try the demo
          </Link>
          <Link
            href="/docs/getting-started"
            className="rounded-md border border-ink-700 px-5 py-2.5 font-medium text-ink-200 hover:border-ink-600 hover:text-white"
          >
            Get started
          </Link>
          <Link
            href="/docs/painting-on-images"
            className="rounded-md px-5 py-2.5 font-medium text-ink-200 hover:text-white"
          >
            Paint on images →
          </Link>
        </div>
      </div>
    </section>
  );
}
