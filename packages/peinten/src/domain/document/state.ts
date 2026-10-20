import type { ClientId, DocNode, NodeId, PaintLayer, SelectionMask } from './nodes.ts';

/** Committed, immutable document state. Only operations produce new states. */
export interface DocState {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyMap<NodeId, DocNode>;
  /** Top-level children. Lower index is drawn first. */
  readonly rootIds: readonly NodeId[];
  /** Selection of each client. A missing entry means "nothing selected". */
  readonly selections: ReadonlyMap<ClientId, SelectionMask>;
}

/** Creates a document containing one empty paint layer. */
export function createDocState(width: number, height: number, firstLayerId: NodeId): DocState {
  const layer: PaintLayer = {
    kind: 'paint',
    id: firstLayerId,
    parentId: null,
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    alphaLocked: false,
    tiles: new Map(),
  };
  return { width, height, nodes: new Map([[layer.id, layer]]), rootIds: [layer.id], selections: new Map() };
}

export function getNode(state: DocState, id: NodeId): DocNode {
  const node = state.nodes.get(id);
  if (!node) throw new Error(`Unknown node: ${id}`);
  return node;
}

/** Returns true when `ancestorId` is `id` itself or one of its ancestors. */
export function isAncestorOrSelf(state: DocState, ancestorId: NodeId, id: NodeId | null): boolean {
  for (let current = id; current !== null; current = getNode(state, current).parentId) {
    if (current === ancestorId) return true;
  }
  return false;
}

/** Visits every node depth-first in drawing order (bottom to top). */
export function walkNodes(state: DocState, visit: (node: DocNode, depth: number) => void): void {
  const walk = (ids: readonly NodeId[], depth: number) => {
    for (const id of ids) {
      const node = getNode(state, id);
      visit(node, depth);
      if (node.kind === 'group') walk(node.childIds, depth + 1);
    }
  };
  walk(state.rootIds, 0);
}

/** Where a new node goes so that it appears directly above the active node, or inside it if it is a group. */
export function placementAbove(state: DocState, activeId: NodeId | null): { parentId: NodeId | null; index: number } {
  const active = activeId ? state.nodes.get(activeId) : undefined;
  if (!active) return { parentId: null, index: state.rootIds.length };
  if (active.kind === 'group') return { parentId: active.id, index: active.childIds.length };
  const parent = active.parentId ? getNode(state, active.parentId) : null;
  const siblings = parent?.kind === 'group' ? parent.childIds : state.rootIds;
  return { parentId: active.parentId, index: siblings.indexOf(active.id) + 1 };
}
