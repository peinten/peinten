'use client';
import type { PaintView } from 'peinten';
import { useEffect, useRef } from 'react';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from './editor-context';
import { PeerCursors } from './peer-cursors';
import { ToolOptions } from './tool-options';

export function CanvasArea() {
  const { runtime, document, view, setView } = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let disposed = false;
    let created: PaintView | null = null;
    runtime.createView({ canvas: canvas.current!, document }).then((v) => {
      if (disposed) void v.dispose();
      else {
        created = v;
        setView(v);
      }
    });
    return () => {
      disposed = true;
      setView(null);
      void created?.dispose();
    };
  }, [runtime, document, setView]);

  return (
    <main className="relative row-start-2 min-h-0 min-w-0 bg-ink-950">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full outline-none" />
      <ToolOptions />
      {view && <PeerCursors view={view} canvas={canvas} />}
      {view && <ViewHud view={view} />}
    </main>
  );
}

function ViewHud({ view }: { view: PaintView }) {
  const viewport = useSnapshot(view, (s) => s.viewport);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-xs text-ink-400">
      <span className="rounded bg-ink-900/80 px-2 py-1">{Math.round(viewport.zoom * 100)}%</span>
      {viewport.rotation !== 0 && (
        <span className="rounded bg-ink-900/80 px-2 py-1">{Math.round((viewport.rotation * 180) / Math.PI)}°</span>
      )}
      <button
        type="button"
        className="pointer-events-auto rounded bg-ink-900/80 px-2 py-1 hover:text-ink-200"
        onClick={() => view.setViewport({ rotation: 0, flipX: false })}
      >
        Reset rotation
      </button>
    </div>
  );
}
