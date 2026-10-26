'use client';
import { type NodeSnapshot, ops } from 'peinten';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';

const BUTTON = 'rounded bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-40';

/** Adds, edits and removes the active node's layer mask. */
export function MaskControls({ node }: { node: NodeSnapshot }) {
  const { document } = useEditor();
  const editing = useSnapshot(document, (s) => s.editingMask);
  const hasSelection = useSnapshot(document, (s) => s.selection !== null);
  const nodeId = node.id;

  if (!node.mask) {
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs text-ink-400">
        <span className="mr-1">Add mask:</span>
        <button
          type="button"
          className={BUTTON}
          title="White mask: the layer stays visible; paint black to hide parts"
          onClick={() => void document.dispatch(ops.addMask({ nodeId }))}
        >
          Show all
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Black mask: the layer disappears; paint white to show parts"
          onClick={() => void document.dispatch(ops.addMask({ nodeId, from: 'hide' }))}
        >
          Hide all
        </button>
        <button
          type="button"
          className={BUTTON}
          disabled={!hasSelection}
          title={hasSelection ? 'Show only the selected area' : 'Select an area first'}
          onClick={() => void document.dispatch([ops.addMask({ nodeId, from: 'selection' }), ops.deselect()])}
        >
          From selection
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs text-ink-400">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1">Mask</span>
        <button
          type="button"
          aria-pressed={editing}
          className={`${BUTTON} ${editing ? 'bg-accent text-white hover:bg-accent/90' : ''}`}
          title={
            editing ? 'The brush paints the mask; click to paint the layer again' : 'Paint the mask with the brush'
          }
          onClick={() => void document.setEditingMask(!editing)}
        >
          {editing ? 'Painting mask' : 'Paint mask'}
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Swap what the mask shows and hides"
          onClick={() => void document.dispatch(ops.updateMask({ nodeId, invert: true }))}
        >
          Invert
        </button>
        {node.kind === 'paint' && (
          <button
            type="button"
            className={BUTTON}
            title="Erase the hidden parts from the layer and remove the mask"
            onClick={() => void document.dispatch(ops.applyMask({ nodeId }))}
          >
            Apply
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          title="Remove the mask; the whole layer shows again"
          onClick={() => void document.dispatch(ops.removeMask({ nodeId }))}
        >
          Remove
        </button>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={node.mask.enabled}
            onChange={(e) => void document.dispatch(ops.updateMask({ nodeId, enabled: e.target.checked }))}
          />
          Enabled
        </label>
      </div>
      {editing && <p>Brushes paint the mask: white shows the layer, black hides it, the eraser hides.</p>}
    </div>
  );
}
