'use client';
import { useEffect, useId, useRef } from 'react';

const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

/** Renders a Mermaid diagram in the site's colors. Mermaid measures text in the DOM, so it runs on the client only. */
export function MermaidDiagram({ chart, label }: { chart: string; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  // Mermaid uses the id in CSS selectors, which React's id characters would break.
  const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`;

  useEffect(() => {
    let cancelled = false;
    // Loaded on demand: Mermaid is large and only a few pages have diagrams.
    void import('mermaid').then(async ({ default: mermaid }) => {
      const text = cssColor('ink-200');
      const line = cssColor('ink-400');
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        fontFamily: 'inherit',
        themeVariables: {
          darkMode: true,
          background: cssColor('ink-900'),
          primaryColor: cssColor('ink-800'),
          primaryTextColor: text,
          primaryBorderColor: cssColor('ink-600'),
          lineColor: line,
          textColor: text,
          actorBkg: cssColor('ink-800'),
          actorBorder: cssColor('ink-600'),
          actorTextColor: text,
          actorLineColor: cssColor('ink-700'),
          signalColor: line,
          signalTextColor: text,
          labelBoxBkgColor: cssColor('ink-850'),
          labelBoxBorderColor: cssColor('ink-600'),
          labelTextColor: text,
          loopTextColor: text,
          noteBkgColor: cssColor('ink-850'),
          noteBorderColor: cssColor('ink-700'),
          noteTextColor: text,
        },
      });
      const { svg } = await mermaid.render(id, chart);
      if (!cancelled && container.current) container.current.innerHTML = svg;
    });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className="not-prose my-6 flex min-h-24 justify-center overflow-x-auto rounded-lg border border-ink-800 bg-ink-900 p-4"
    />
  );
}
