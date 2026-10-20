'use client';
import type { CreateDocumentOptions, PaintDocument, PaintRuntime, PaintView } from 'peinten';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRuntime } from '@/engine/runtime';
import type { Tools } from '@/engine/tools';
import { CanvasArea } from './canvas-area';
import { EditorContext } from './editor-context';
import { BrushPanel } from './panels/brush-panel';
import { ColorPanel } from './panels/color-panel';
import { LayersPanel } from './panels/layers-panel';
import { TextPanel } from './panels/text-panel';
import { Shortcuts } from './shortcuts';
import { Toolbar } from './toolbar';
import { TopBar } from './top-bar';

const DEFAULT_SIZE = { width: 1600, height: 1200 };

export function Editor() {
  const [runtime, setRuntime] = useState<PaintRuntime<Tools> | null>(null);
  const [document, setDocument] = useState<PaintDocument | null>(null);
  const [view, setView] = useState<PaintView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<PaintDocument | null>(null);

  const replaceDocument = useCallback((next: PaintDocument | null) => {
    const previous = current.current;
    current.current = next;
    setDocument(next);
    void previous?.dispose();
  }, []);

  useEffect(() => {
    getRuntime().then(setRuntime, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    runtime.createDocument(DEFAULT_SIZE).then(
      (doc) => {
        if (cancelled) void doc.dispose();
        else replaceDocument(doc);
      },
      (reason: unknown) => setError(String(reason)),
    );
    return () => {
      cancelled = true;
      replaceDocument(null);
    };
  }, [runtime, replaceDocument]);

  const context = useMemo(
    () =>
      runtime && document
        ? {
            runtime,
            document,
            view,
            setView,
            openDocument: async (options: CreateDocumentOptions) =>
              replaceDocument(await runtime.createDocument(options)),
          }
        : null,
    [runtime, document, view, replaceDocument],
  );

  if (error) {
    return (
      <main className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-red-900/60 bg-red-950/40 p-6">
          <h1 className="mb-2 font-semibold text-red-200">This demo needs WebGPU</h1>
          <p className="text-red-200/80">{error}</p>
          <p className="mt-3 text-ink-400">Use a recent Chrome, Edge or Safari with WebGPU enabled.</p>
        </div>
      </main>
    );
  }
  if (!context)
    return <main className="flex h-full items-center justify-center text-ink-400">Starting the engine…</main>;

  return (
    <EditorContext value={context}>
      <div className="grid h-full grid-cols-[3rem_18rem_1fr] grid-rows-[2.5rem_1fr]">
        <TopBar />
        <Toolbar />
        <aside className="row-start-2 flex min-h-0 flex-col gap-px overflow-y-auto border-r border-ink-800 bg-ink-800">
          <ColorPanel />
          <BrushPanel />
          <LayersPanel />
          <TextPanel />
        </aside>
        <CanvasArea />
      </div>
      <Shortcuts />
    </EditorContext>
  );
}
