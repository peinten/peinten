'use client';
import { ops } from 'peinten';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { useEditor } from './editor-context';

/** Where the current image stays on the resized canvas, as a fraction of the size change per axis. */
const ANCHORS = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));

/** Changes the canvas size around an anchor, cropping or extending every layer. */
export function CanvasSizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { document } = useEditor();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [anchor, setAnchor] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    if (!open) return;
    const { width, height } = document.getSnapshot();
    setSize({ width, height });
  }, [open, document]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Canvas size">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const current = document.getSnapshot();
          void document.dispatch(
            ops.resizeCanvas({
              ...size,
              offsetX: Math.round((size.width - current.width) * anchor.x),
              offsetY: Math.round((size.height - current.height) * anchor.y),
            }),
          );
          onOpenChange(false);
        }}
      >
        {(['width', 'height'] as const).map((key) => (
          <label key={key} className="flex items-center justify-between gap-3 text-xs capitalize text-ink-400">
            {key}
            <input
              type="number"
              min={1}
              max={8192}
              value={size[key]}
              onChange={(e) => setSize((s) => ({ ...s, [key]: Number(e.target.value) }))}
              className="w-28 rounded bg-ink-800 px-2 py-1 text-right text-ink-200"
            />
          </label>
        ))}
        <div className="flex items-center justify-between text-xs text-ink-400">
          Anchor
          <div className="grid grid-cols-3 gap-1">
            {ANCHORS.map((a) => (
              <button
                key={`${a.x},${a.y}`}
                type="button"
                aria-label={`Anchor ${a.x * 2},${a.y * 2}`}
                aria-pressed={a.x === anchor.x && a.y === anchor.y}
                onClick={() => setAnchor(a)}
                className={`size-5 rounded-sm ${a.x === anchor.x && a.y === anchor.y ? 'bg-accent' : 'bg-ink-800 hover:bg-ink-700'}`}
              />
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-400">Pixels outside the new canvas are removed. Undo restores them.</p>
        <button type="submit" className="w-full rounded bg-accent py-1.5 font-medium text-white">
          Resize
        </button>
      </form>
    </Modal>
  );
}
