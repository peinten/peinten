import type { BrushSettings } from '../brush/settings.ts';
import type { NodeId, NodeProps } from '../document/nodes.ts';
import type { SelectionMode } from '../document/selection.ts';
import type { FilterSpec } from '../filters/filter.ts';
import { IDENTITY_AFFINE } from '../geometry/affine.ts';
import { rgba8ToTiles } from '../raster/pixels.ts';
import type { WarpMesh } from '../raster/warp.ts';
import { DEFAULT_TEXT_STYLE, type TextLayerData } from '../text/text-layer.ts';
import { tileCoords } from '../tiles/tile.ts';
import type { Rect } from '../tiles/tile-map.ts';
import type { ApplyFilterDraft } from './filter-ops.ts';
import { newId } from './ids.ts';
import type {
  AddAdjustmentLayerDraft,
  AddGroupDraft,
  AddLayerDraft,
  AddTextLayerDraft,
  DuplicateNodeDraft,
  MoveNodeDraft,
  RemoveNodeDraft,
  UpdateNodeDraft,
  UpdateTextDraft,
} from './node-ops.ts';
import type { ClearDraft, PutTilesDraft, StrokeDraft } from './raster-ops.ts';
import type { MoveSelectionDraft, SelectionShape, SelectShapeDraft, SelectWandDraft } from './selection-ops.ts';
import type { StrokeTarget } from './stroke-renderer.ts';
import type { RasterizeNodeDraft } from './text-ops.ts';
import type { WarpDraft } from './transform-ops.ts';

interface Placement {
  readonly parentId?: NodeId | null;
  readonly index?: number;
  readonly name?: string;
}

const place = (p: Placement, fallbackName: string) => ({
  nodeId: newId(),
  parentId: p.parentId ?? null,
  index: p.index ?? Number.MAX_SAFE_INTEGER,
  name: p.name ?? fallbackName,
});

/** Creates a 32-bit seed for brush randomness. */
const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);

/**
 * Factories for core operation drafts. Ids are generated here, so callers can reference new nodes
 * (for example `ops.addLayer().nodeId`) before dispatching. A missing index appends on top.
 */
export const ops = {
  addLayer: (p: Placement = {}): AddLayerDraft => ({ type: 'add-layer', ...place(p, 'Layer') }),
  addGroup: (p: Placement = {}): AddGroupDraft => ({ type: 'add-group', ...place(p, 'Group') }),
  addAdjustmentLayer: (p: Placement & { readonly filter: FilterSpec }): AddAdjustmentLayerDraft => ({
    type: 'add-adjustment-layer',
    ...place(p, 'Adjustment'),
    filter: p.filter,
  }),
  addTextLayer: (p: Placement & { readonly text?: Partial<TextLayerData> }): AddTextLayerDraft => ({
    type: 'add-text-layer',
    ...place(p, 'Text'),
    text: {
      transform: IDENTITY_AFFINE,
      frame: { kind: 'point' },
      writingMode: 'horizontal-tb',
      paragraph: { align: 'start', lineHeight: 1.4 },
      runs: [{ text: 'Text', style: DEFAULT_TEXT_STYLE }],
      ...p.text,
    },
  }),
  removeNode: (p: { readonly nodeId: NodeId }): RemoveNodeDraft => ({ type: 'remove-node', nodeId: p.nodeId }),
  moveNode: (p: {
    readonly nodeId: NodeId;
    readonly parentId: NodeId | null;
    readonly index: number;
  }): MoveNodeDraft => ({
    type: 'move-node',
    ...p,
  }),
  updateNode: (p: { readonly nodeId: NodeId; readonly props: Partial<NodeProps> }): UpdateNodeDraft => ({
    type: 'update-node',
    ...p,
  }),
  updateText: (p: { readonly nodeId: NodeId; readonly text: Partial<TextLayerData> }): UpdateTextDraft => ({
    type: 'update-text',
    ...p,
  }),
  duplicateNode: (p: { readonly nodeId: NodeId }): DuplicateNodeDraft => ({
    type: 'duplicate-node',
    nodeId: p.nodeId,
    newNodeId: newId(),
  }),
  stroke: (p: {
    readonly target: StrokeTarget;
    readonly brush: BrushSettings;
    readonly samples: Float32Array;
    readonly seed?: number;
  }): StrokeDraft => ({
    type: 'stroke',
    target: p.target,
    brush: p.brush,
    samples: p.samples,
    seed: p.seed ?? randomSeed(),
  }),
  clear: (p: { readonly nodeId: NodeId }): ClearDraft => ({ type: 'clear', nodeId: p.nodeId }),
  /** Writes straight 8-bit RGBA pixels (e.g. from `ImageData`) into a paint layer at (x, y). */
  putPixels: (p: {
    readonly nodeId: NodeId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly data: ArrayLike<number>;
  }): PutTilesDraft => ({
    type: 'put-tiles',
    nodeId: p.nodeId,
    replace: false,
    tiles: [...rgba8ToTiles(p.data, p.width, p.height, p.x, p.y)].map(([key, data]) => {
      const [tx, ty] = tileCoords(key);
      return { tx, ty, data };
    }),
  }),
  warp: (p: { readonly nodeId: NodeId; readonly source: Rect; readonly mesh: WarpMesh }): WarpDraft => ({
    type: 'warp',
    ...p,
  }),
  applyFilter: (p: { readonly nodeId: NodeId; readonly filter: FilterSpec }): ApplyFilterDraft => ({
    type: 'apply-filter',
    ...p,
  }),
  rasterizeNode: (p: { readonly nodeId: NodeId }): RasterizeNodeDraft => ({ type: 'rasterize-node', nodeId: p.nodeId }),
  selectAll: () => ({ type: 'select-all' }) as const,
  deselect: () => ({ type: 'deselect' }) as const,
  invertSelection: () => ({ type: 'invert-selection' }) as const,
  moveSelection: (p: { readonly dx: number; readonly dy: number }): MoveSelectionDraft => ({
    type: 'move-selection',
    dx: Math.round(p.dx),
    dy: Math.round(p.dy),
  }),
  selectShape: (p: {
    readonly mode: SelectionMode;
    readonly shape: SelectionShape;
    readonly antialias?: boolean;
  }): SelectShapeDraft => ({
    type: 'select-shape',
    mode: p.mode,
    shape: p.shape,
    antialias: p.antialias ?? true,
  }),
  selectWand: (p: Omit<SelectWandDraft, 'type'>): SelectWandDraft => ({ type: 'select-wand', ...p }),
};
