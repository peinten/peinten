/** Footer with licensing credits for the ported brush engine. */
export function SiteFooter() {
  return (
    <footer className="border-t border-ink-800">
      <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-ink-400">
        peinten is MIT licensed. The brush engine is ported from libmypaint (ISC); bundled presets come from
        mypaint-brushes (CC0).
      </div>
    </footer>
  );
}
