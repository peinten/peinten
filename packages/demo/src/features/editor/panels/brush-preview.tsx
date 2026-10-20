'use client';
import { ops, type PaintDocument, previewStrokeSamples, resolveBrush } from 'peinten';
import { useEffect, useRef, useState } from 'react';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';

const SIZE = { width: 512, height: 96 };

/** Renders the current brush with an S-shaped stroke in its own small document. */
export function BrushPreview() {
  const { runtime } = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PaintDocument | null>(null);
  const resources = useSnapshot(runtime, (s) => s.resources);

  // A dedicated document and view: its history and GPU caches never mix with the main canvas.
  useEffect(() => {
    let disposed = false;
    const created = (async () => {
      const preview = await runtime.createDocument({ ...SIZE, history: false });
      const view = await runtime.createView({
        canvas: canvas.current!,
        document: preview,
        input: false,
        background: 'transparent',
      });
      if (!disposed) setDoc(preview);
      return { preview, view };
    })();
    return () => {
      disposed = true;
      void created.then(({ preview, view }) => {
        void view.dispose();
        void preview.dispose();
      });
    };
  }, [runtime]);

  // Redraw the same stroke whenever the brush or color changes.
  useEffect(() => {
    if (!doc) return;
    const nodeId = doc.getSnapshot().rootIds[0]!;
    void doc.dispatch([
      ops.clear({ nodeId }),
      ops.stroke({ target: { nodeId }, brush: resolveBrush(resources), samples: previewStrokeSamples(SIZE), seed: 1 }),
    ]);
  }, [doc, resources]);

  return <canvas ref={canvas} className="h-12 w-full rounded bg-ink-950" />;
}
