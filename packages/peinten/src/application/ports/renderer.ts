import type { NodeId } from '../../domain/document/nodes.ts';
import type { DocState } from '../../domain/document/state.ts';
import type { FilterSpec } from '../../domain/filters/filter.ts';
import type { FilterExecutor } from '../../domain/ops/context.ts';
import type { WarpMesh } from '../../domain/raster/warp.ts';
import type { TileKey } from '../../domain/tiles/tile.ts';
import type { MaskMap, Rect, TileMap } from '../../domain/tiles/tile-map.ts';
import type { OverlayGeometry } from '../overlay.ts';
import type { CanvasSize, Viewport } from '../viewport.ts';

/** A live preview of a warp: the selected content of `nodeId` drawn through `mesh`. */
export interface WarpPreview {
  readonly nodeId: NodeId;
  readonly source: Rect;
  readonly mesh: WarpMesh;
}

/** Tiles of a stroke in progress that shadow the committed tiles of a node. */
export interface LiveTiles {
  readonly nodeId: NodeId;
  readonly tiles: ReadonlyMap<TileKey, Uint16Array>;
}

/** Everything a document renderer needs to show the current document. */
export interface RenderSource {
  readonly state: DocState;
  /** Strokes in progress: this client's and peers'. Where two cover the same tile, the earlier one is shown. */
  readonly live: readonly LiveTiles[];
  /** Rendered text layers. Missing entries are drawn transparent until rasterized. */
  readonly textRasters: ReadonlyMap<NodeId, TileMap>;
  /** Selection of this client, shown with marching ants or as a quick mask. */
  readonly selection: MaskMap | null;
  /** Live tiles of a quick-mask stroke that shadow `selection`. */
  readonly liveSelection: ReadonlyMap<TileKey, Uint16Array> | null;
  /** Live tiles of a stroke on a layer mask that shadow that node's mask tiles. */
  readonly liveMask: { readonly nodeId: NodeId; readonly tiles: ReadonlyMap<TileKey, Uint16Array> } | null;
  readonly quickMask: boolean;
  /** Draws the selection outline shifted by whole pixels while a tool drags it. */
  readonly selectionOffset: { readonly x: number; readonly y: number } | null;
  readonly warpPreview: WarpPreview | null;
  readonly filterPreview: { readonly nodeId: NodeId; readonly filter: FilterSpec } | null;
}

/** Tiles mutated in place since the previous sync, which identity comparison cannot detect. */
export interface DirtyHint {
  readonly liveKeys: ReadonlyMap<NodeId, readonly TileKey[]>;
  readonly liveSelectionKeys: readonly TileKey[];
  readonly liveMaskKeys: readonly TileKey[];
}

/** GPU caches of one document: tile atlas, composite, intermediates. Port implemented in infrastructure. */
export interface DocumentRenderCache {
  /** Uploads what changed since the previous call and recomposites the affected region. */
  sync(source: RenderSource, hint: DirtyHint): void;
  /** Straight 8-bit RGBA of the whole composite. */
  readComposite(): Promise<Uint8ClampedArray>;
  /** Straight 8-bit RGBA of a group composited in isolation. */
  readGroup(groupId: NodeId): Promise<Uint8ClampedArray>;
  dispose(): void;
}

/** What `PaintView` asks the renderer to draw. */
export type ViewBackground = 'checker' | 'transparent' | readonly [number, number, number];

/** A canvas showing one document. */
export interface ViewSurface {
  resize(size: CanvasSize): void;
  render(viewport: Viewport, overlay: OverlayGeometry, background: ViewBackground, time: number): void;
  dispose(): void;
}

/** The GPU behind a runtime. */
export interface RenderBackend {
  readonly maxDocumentSize: number;
  readonly filterExecutor: FilterExecutor;
  createDocumentCache(width: number, height: number): DocumentRenderCache;
  /** `canvas` is an OffscreenCanvas in workers or an HTMLCanvasElement on the main thread. */
  createViewSurface(canvas: OffscreenCanvas | HTMLCanvasElement, cache: DocumentRenderCache): ViewSurface;
  dispose(): void;
}
