import type { BlendMode } from '../domain/document/blend-mode.ts';
import type { DocNode, NodeId, NodeKind } from '../domain/document/nodes.ts';
import type { DocState } from '../domain/document/state.ts';
import type { FilterSpec } from '../domain/filters/filter.ts';
import { contentBounds } from '../domain/raster/bounds.ts';
import type { TextLayerData } from '../domain/text/text-layer.ts';
import type { Rect } from '../domain/tiles/tile-map.ts';
import type { CollabState } from './collab/session.ts';

/** A layer thumbnail. `version` changes whenever `bitmap` does, so consumers can skip redrawing. */
export interface Thumbnail {
  readonly version: number;
  readonly bitmap: ImageBitmap;
}

export interface NodeSnapshot {
  readonly id: NodeId;
  readonly kind: NodeKind;
  readonly parentId: NodeId | null;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly locked: boolean;
  readonly alphaLocked: boolean;
  readonly passThrough: boolean;
  readonly childIds: readonly NodeId[];
  readonly filter: FilterSpec | null;
  readonly text: TextLayerData | null;
  readonly thumbnail: Thumbnail | null;
}

export interface DocumentSnapshot {
  readonly width: number;
  readonly height: number;
  readonly nodes: Readonly<Record<NodeId, NodeSnapshot>>;
  readonly rootIds: readonly NodeId[];
  readonly activeNodeId: NodeId | null;
  /** This client's selection; `bounds` encloses every pixel with any coverage. */
  readonly selection: { readonly bounds: Rect } | null;
  readonly quickMask: boolean;
  readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
  readonly filterPreview: { readonly nodeId: NodeId; readonly filter: FilterSpec } | null;
  readonly collab: CollabState;
}

export interface SnapshotInput {
  readonly state: DocState;
  readonly clientId: string;
  readonly activeNodeId: NodeId | null;
  readonly quickMask: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly thumbnails: ReadonlyMap<NodeId, Thumbnail>;
  readonly filterPreview: DocumentSnapshot['filterPreview'];
  readonly collab: CollabState;
}

function nodeSnapshot(node: DocNode, thumbnail: Thumbnail | null): NodeSnapshot {
  return {
    id: node.id,
    kind: node.kind,
    parentId: node.parentId,
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    locked: 'locked' in node ? node.locked : false,
    alphaLocked: node.kind === 'paint' ? node.alphaLocked : false,
    passThrough: node.kind === 'group' ? node.passThrough : false,
    childIds: node.kind === 'group' ? node.childIds : [],
    filter: node.kind === 'adjustment' ? node.filter : null,
    text: node.kind === 'text' ? node.text : null,
    thumbnail,
  };
}

/**
 * Builds document snapshots that keep the identity of everything that did not change,
 * so `useSyncExternalStore` selectors and memoized components skip unrelated updates.
 */
export class SnapshotBuilder {
  #previous: DocumentSnapshot | null = null;
  readonly #nodeSources = new Map<NodeId, { node: DocNode; thumbnail: Thumbnail | null; snapshot: NodeSnapshot }>();
  #selectionSource: unknown = null;

  build(input: SnapshotInput): DocumentSnapshot {
    const prev = this.#previous;
    const nodes: Record<NodeId, NodeSnapshot> = {};
    let nodesChanged = !prev || prev.width !== input.state.width;
    for (const [id, node] of input.state.nodes) {
      const thumbnail = input.thumbnails.get(id) ?? null;
      const cached = this.#nodeSources.get(id);
      if (cached && cached.node === node && cached.thumbnail === thumbnail) {
        nodes[id] = cached.snapshot;
        continue;
      }
      const snapshot = nodeSnapshot(node, thumbnail);
      this.#nodeSources.set(id, { node, thumbnail, snapshot });
      nodes[id] = snapshot;
      nodesChanged = true;
    }
    for (const id of this.#nodeSources.keys()) {
      if (!input.state.nodes.has(id)) {
        this.#nodeSources.delete(id);
        nodesChanged = true;
      }
    }
    const mask = input.state.selections.get(input.clientId) ?? null;
    let selection = prev?.selection ?? null;
    if (mask !== this.#selectionSource) {
      this.#selectionSource = mask;
      const bounds = mask ? contentBounds(mask, 1) : null;
      selection = bounds ? { bounds } : null;
    }
    const history =
      prev && prev.history.canUndo === input.canUndo && prev.history.canRedo === input.canRedo
        ? prev.history
        : { canUndo: input.canUndo, canRedo: input.canRedo };
    const next: DocumentSnapshot = {
      width: input.state.width,
      height: input.state.height,
      nodes: nodesChanged || !prev ? nodes : prev.nodes,
      rootIds: prev && prev.rootIds === input.state.rootIds ? prev.rootIds : input.state.rootIds,
      activeNodeId: input.activeNodeId,
      selection,
      quickMask: input.quickMask,
      history,
      filterPreview: input.filterPreview,
      collab: input.collab,
    };
    if (
      prev &&
      prev.nodes === next.nodes &&
      prev.rootIds === next.rootIds &&
      prev.activeNodeId === next.activeNodeId &&
      prev.selection === next.selection &&
      prev.quickMask === next.quickMask &&
      prev.history === next.history &&
      prev.filterPreview === next.filterPreview &&
      prev.collab === next.collab
    ) {
      return prev;
    }
    this.#previous = next;
    return next;
  }
}
