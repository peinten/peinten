'use client';
import { dragAndDropFeature, hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Lock,
  Plus,
  SlidersHorizontal,
  Trash2,
  Type,
} from 'lucide-react';
import { BLEND_MODES, type DocumentSnapshot, type NodeSnapshot, type OperationDraft, ops } from 'peinten';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/icon-button';
import { LabeledSlider } from '@/components/labeled-slider';
import { Panel } from '@/components/panel';
import { SelectField } from '@/components/select-field';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';
import { MaskControls } from './mask-controls';

const ROOT = '__root__';
const BLEND_ITEMS = BLEND_MODES.map((mode) => ({
  value: mode,
  label: mode[0]!.toUpperCase() + mode.slice(1).replace(/-/g, ' '),
}));

/** Where a new node goes: just above the active node, inside the same folder. */
export function placementAbove(snapshot: DocumentSnapshot): { parentId: string | null; index: number } {
  const active = snapshot.activeNodeId ? snapshot.nodes[snapshot.activeNodeId] : undefined;
  if (!active) return { parentId: null, index: snapshot.rootIds.length };
  if (active.kind === 'group') return { parentId: active.id, index: active.childIds.length };
  const siblings = active.parentId ? snapshot.nodes[active.parentId]!.childIds : snapshot.rootIds;
  return { parentId: active.parentId, index: siblings.indexOf(active.id) + 1 };
}

/** A 40×30 canvas showing a thumbnail bitmap, letterboxed. */
function ThumbnailCanvas({ thumbnail, className }: { thumbnail: NodeSnapshot['thumbnail']; className: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !thumbnail) return;
    const { bitmap } = thumbnail;
    ctx.clearRect(0, 0, 40, 30);
    const scale = Math.min(40 / bitmap.width, 30 / bitmap.height);
    ctx.drawImage(
      bitmap,
      (40 - bitmap.width * scale) / 2,
      (30 - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
  }, [thumbnail]);
  return <canvas ref={canvas} width={40} height={30} className={className} />;
}

function Thumbnail({ node }: { node: NodeSnapshot }) {
  if (node.kind === 'group') return <Folder className="mx-3 size-4 text-ink-400" />;
  if (node.kind === 'adjustment') return <SlidersHorizontal className="mx-3 size-4 text-ink-400" />;
  if (node.kind === 'text' && !node.thumbnail) return <Type className="mx-3 size-4 text-ink-400" />;
  return (
    <ThumbnailCanvas
      thumbnail={node.thumbnail}
      className="rounded-sm bg-[conic-gradient(#888_25%,#bbb_0_50%,#888_0_75%,#bbb_0)] bg-[length:8px_8px]"
    />
  );
}

/**
 * headless-tree rejects falsy item data, and the item list can still hold a removed node for one render
 * before `rebuildTree` runs, so the node is wrapped and may be missing.
 */
interface TreeItemData {
  readonly node: NodeSnapshot | undefined;
}

export function LayersPanel() {
  const { document } = useEditor();
  const snapshot = useSnapshot(document, (s) => s);
  const data = useRef(snapshot);
  data.current = snapshot;
  const [renaming, setRenaming] = useState<string | null>(null);

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT,
    getItemName: (item) => item.getItemData().node?.name ?? '',
    isItemFolder: (item) => item.getId() === ROOT || item.getItemData().node?.kind === 'group',
    dataLoader: {
      getItem: (id) => ({ node: data.current.nodes[id] }),
      // The panel lists the topmost layer first, the reverse of drawing order.
      getChildren: (id) =>
        [...(id === ROOT ? data.current.rootIds : (data.current.nodes[id]?.childIds ?? []))].reverse(),
    },
    canReorder: true,
    onDrop: (items, target) => {
      const parentId = target.item.getId() === ROOT ? null : target.item.getId();
      const moved = items.map((item) => item.getId());
      const siblings = (parentId ? data.current.nodes[parentId]!.childIds : data.current.rootIds).filter(
        (id) => !moved.includes(id),
      );
      const displayIndex = 'insertionIndex' in target ? target.insertionIndex : 0;
      const index = siblings.length - displayIndex;
      void document.dispatch(moved.map((nodeId) => ops.moveNode({ nodeId, parentId, index })));
    },
    indent: 14,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, dragAndDropFeature],
  });

  // The data loader reads from a ref, so the tree must be told when the layer data changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes and rootIds are the change triggers
  useEffect(() => {
    tree.rebuildTree();
  }, [snapshot.nodes, snapshot.rootIds, tree]);

  const active = snapshot.activeNodeId ? snapshot.nodes[snapshot.activeNodeId] : undefined;
  const update = (props: Parameters<typeof ops.updateNode>[0]['props']) =>
    active && void document.dispatch(ops.updateNode({ nodeId: active.id, props }));
  const add = (draft: OperationDraft & { nodeId: string }) => {
    void document.dispatch(draft).then(() => document.setActiveNode(draft.nodeId));
  };

  return (
    <Panel
      title="Layers"
      actions={
        <>
          <IconButton
            label="New layer"
            onClick={() =>
              add(
                ops.addLayer({ ...placementAbove(snapshot), name: `Layer ${Object.keys(snapshot.nodes).length + 1}` }),
              )
            }
          >
            <Plus className="size-3.5" />
          </IconButton>
          <IconButton label="New folder" onClick={() => add(ops.addGroup(placementAbove(snapshot)))}>
            <FolderPlus className="size-3.5" />
          </IconButton>
          <IconButton
            label="New blur adjustment layer"
            onClick={() =>
              add(
                ops.addAdjustmentLayer({
                  ...placementAbove(snapshot),
                  name: 'Gaussian blur',
                  filter: { type: 'gaussian-blur', radius: 8 },
                }),
              )
            }
          >
            <SlidersHorizontal className="size-3.5" />
          </IconButton>
          <IconButton
            label="Duplicate"
            onClick={() => active && void document.dispatch(ops.duplicateNode({ nodeId: active.id }))}
          >
            <Copy className="size-3.5" />
          </IconButton>
          <IconButton
            label="Delete"
            onClick={() => active && void document.dispatch(ops.removeNode({ nodeId: active.id }))}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </>
      }
    >
      {active && (
        <div className="mb-2 space-y-1 border-b border-ink-800 pb-2">
          <SelectField value={active.blendMode} items={BLEND_ITEMS} onChange={(blendMode) => update({ blendMode })} />
          <LabeledSlider
            label="Opacity"
            value={Math.round(active.opacity * 100)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onCommit={(v) => update({ opacity: v / 100 })}
          />
          {active.filter?.type === 'gaussian-blur' && (
            <LabeledSlider
              label="Blur radius"
              value={active.filter.radius}
              min={0}
              max={100}
              format={(v) => `${v}px`}
              onCommit={(radius) => update({ filter: { type: 'gaussian-blur', radius } })}
            />
          )}
          <div className="flex gap-3 text-xs text-ink-400">
            {active.kind !== 'adjustment' && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={active.locked} onChange={(e) => update({ locked: e.target.checked })} />{' '}
                Lock
              </label>
            )}
            {active.kind === 'paint' && (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={active.alphaLocked}
                  onChange={(e) => update({ alphaLocked: e.target.checked })}
                />{' '}
                Alpha lock
              </label>
            )}
            {active.kind === 'group' && (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={active.passThrough}
                  onChange={(e) => update({ passThrough: e.target.checked })}
                />{' '}
                Pass-through
              </label>
            )}
          </div>
          <MaskControls node={active} />
        </div>
      )}
      <div {...tree.getContainerProps('Layers')} className="relative">
        {tree.getItems().map((item) => {
          const { node } = item.getItemData();
          if (!node) return null;
          const level = item.getItemMeta().level;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: getProps() supplies the treeitem role, tabIndex and key handling
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection comes from headless-tree's hotkeys
            <div
              key={item.getKey()}
              {...item.getProps()}
              onClick={() => void document.setActiveNode(node.id)}
              onDoubleClick={() => setRenaming(node.id)}
              style={{ paddingLeft: level * 14 + 4 }}
              className={`flex h-9 cursor-default items-center gap-1 rounded pr-1 ${node.id === snapshot.activeNodeId ? 'bg-accent/15' : 'hover:bg-ink-800'} ${
                item.isDragTarget() ? 'ring-1 ring-accent' : ''
              }`}
            >
              <span className="flex w-4 justify-center text-ink-400">
                {node.kind === 'group' &&
                  (item.isExpanded() ? (
                    <ChevronDown
                      className="size-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        item.collapse();
                      }}
                    />
                  ) : (
                    <ChevronRight
                      className="size-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        item.expand();
                      }}
                    />
                  ))}
              </span>
              <Thumbnail node={node} />
              {node.mask && (
                <button
                  type="button"
                  aria-label="Paint mask"
                  title={
                    node.mask.enabled ? 'Layer mask: click to paint it' : 'Layer mask (disabled): click to paint it'
                  }
                  onClick={() => void document.setActiveNode(node.id).then(() => document.setEditingMask(true))}
                  className={`rounded-sm ring-offset-1 ring-offset-ink-900 ${
                    node.id === snapshot.activeNodeId && snapshot.editingMask ? 'ring-2 ring-accent' : ''
                  } ${node.mask.enabled ? '' : 'opacity-40'}`}
                >
                  <ThumbnailCanvas thumbnail={node.mask.thumbnail} className="block rounded-sm bg-ink-950" />
                </button>
              )}
              {renaming === node.id ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: rename input opens on explicit double click
                  autoFocus
                  defaultValue={node.name}
                  className="min-w-0 flex-1 rounded bg-ink-950 px-1 text-xs"
                  onBlur={(e) => {
                    setRenaming(null);
                    if (e.target.value !== node.name)
                      void document.dispatch(ops.updateNode({ nodeId: node.id, props: { name: e.target.value } }));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              ) : (
                <span className={`min-w-0 flex-1 truncate text-xs ${node.visible ? '' : 'text-ink-400 line-through'}`}>
                  {node.name}
                  {node.blendMode !== 'normal' && <span className="ml-1 text-ink-400">· {node.blendMode}</span>}
                </span>
              )}
              {node.locked && <Lock className="size-3 text-ink-400" />}
              <IconButton
                label={node.visible ? 'Hide' : 'Show'}
                onClick={() =>
                  void document.dispatch(ops.updateNode({ nodeId: node.id, props: { visible: !node.visible } }))
                }
              >
                {node.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </IconButton>
            </div>
          );
        })}
        <div style={tree.getDragLineStyle()} className="h-0.5 bg-accent" />
      </div>
    </Panel>
  );
}
