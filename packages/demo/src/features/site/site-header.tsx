import Image from 'next/image';
import Link from 'next/link';

/** Top navigation of the landing page and the docs. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 text-sm">
        <Link href="/" className="shrink-0">
          <Image
            src="/brand/peinten-logo-dark.svg"
            alt="peinten"
            width={1223}
            height={320}
            preload
            className="h-7 w-auto"
          />
        </Link>
        <Link href="/docs" className="text-ink-400 hover:text-ink-200">
          Docs
        </Link>
        <a
          href="https://github.com/peinten/peinten"
          target="_blank"
          rel="noreferrer"
          className="text-ink-400 hover:text-ink-200"
        >
          GitHub
        </a>
        <Link
          href="/demo"
          className="ml-auto whitespace-nowrap rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent/90"
        >
          Open demo
        </Link>
      </nav>
    </header>
  );
}
