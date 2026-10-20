'use client';
import { ops } from 'peinten';
import { useEffect, useState } from 'react';
import { LabeledSlider } from '@/components/labeled-slider';
import { Modal } from '@/components/modal';
import { useEditor } from './editor-context';

/** Destructive Gaussian blur with a live preview of the active layer. */
export function BlurDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { document } = useEditor();
  const [radius, setRadius] = useState(8);
  const nodeId = document.getSnapshot().activeNodeId;
  const target = nodeId ? document.getSnapshot().nodes[nodeId] : undefined;
  const canApply = target?.kind === 'paint';

  useEffect(() => {
    if (!open || !canApply || !nodeId) return;
    void document.setFilterPreview({ nodeId, filter: { type: 'gaussian-blur', radius } });
    return () => void document.setFilterPreview(null);
  }, [open, canApply, nodeId, radius, document]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Gaussian blur">
      {canApply ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (nodeId) void document.dispatch(ops.applyFilter({ nodeId, filter: { type: 'gaussian-blur', radius } }));
            onOpenChange(false);
          }}
        >
          <LabeledSlider
            label="Radius"
            value={radius}
            min={0}
            max={100}
            format={(v) => `${v}px`}
            onChange={setRadius}
          />
          <p className="text-xs text-ink-400">Applies to the active layer, inside the selection if there is one.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded bg-ink-800 px-3 py-1.5 text-ink-200"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button type="submit" className="rounded bg-accent px-3 py-1.5 font-medium text-white">
              Apply
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-400">Select a paint layer to blur it.</p>
      )}
    </Modal>
  );
}
