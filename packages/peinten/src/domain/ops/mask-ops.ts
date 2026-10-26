import * as v from 'valibot';
import { applyLayerMask, invertLayerMask } from '../document/layer-mask.ts';
import type { DocNode, LayerMask, NodeId } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import type { DocState } from '../document/state.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

/** The node, refusing locked ones: a lock protects the mask as well as the pixels. */
function editableNode(state: DocState, nodeId: NodeId): DocNode {
  const node = state.nodes.get(nodeId);
  if (!node) throw new OperationConflictError(`Node ${nodeId} does not exist`);
  if ('locked' in node && node.locked) throw new OperationConflictError(`Layer ${nodeId} is locked`);
  return node;
}

function maskedNode(state: DocState, nodeId: NodeId): DocNode & { readonly mask: LayerMask } {
  const node = editableNode(state, nodeId);
  if (!node.mask) throw new OperationConflictError(`Node ${nodeId} has no mask`);
  return node as DocNode & { readonly mask: LayerMask };
}

function withoutMask<N extends DocNode>(node: N): N {
  const copy: { -readonly [K in keyof N]: N[K] } = { ...node };
  delete copy.mask;
  return copy;
}

function withNode(state: DocState, node: DocNode): DocState {
  const nodes = new Map(state.nodes);
  nodes.set(node.id, node);
  return { ...state, nodes };
}

export interface AddMaskDraft {
  readonly type: 'add-mask';
  readonly nodeId: NodeId;
  /** `reveal` shows everything, `hide` hides everything, `selection` shows the issuer's selection. */
  readonly from: 'reveal' | 'hide' | 'selection';
}

/** Gives a node a mask, replacing any mask it had. */
export const addMaskOp = defineOperation<AddMaskDraft>({
  type: 'add-mask',
  schema: v.object({ nodeId: nodeIdSchema, from: v.picklist(['reveal', 'hide', 'selection']) }),
  apply(state, op) {
    const node = editableNode(state, op.nodeId);
    const mask: LayerMask =
      op.from === 'selection'
        ? { tiles: state.selections.get(op.clientId) ?? new Map(), fill: 0, enabled: true }
        : { tiles: new Map(), fill: op.from === 'reveal' ? 1 : 0, enabled: true };
    return withNode(state, { ...node, mask });
  },
});

export interface RemoveMaskDraft {
  readonly type: 'remove-mask';
  readonly nodeId: NodeId;
}

export const removeMaskOp = defineOperation<RemoveMaskDraft>({
  type: 'remove-mask',
  schema: v.object({ nodeId: nodeIdSchema }),
  apply(state, op) {
    return withNode(state, withoutMask(maskedNode(state, op.nodeId)));
  },
});

export interface UpdateMaskDraft {
  readonly type: 'update-mask';
  readonly nodeId: NodeId;
  /** Turns the mask's effect off or on without discarding it. */
  readonly enabled?: boolean;
  /** Swaps shown and hidden. */
  readonly invert?: boolean;
}

export const updateMaskOp = defineOperation<UpdateMaskDraft>({
  type: 'update-mask',
  schema: v.object({ nodeId: nodeIdSchema, enabled: v.optional(v.boolean()), invert: v.optional(v.boolean()) }),
  apply(state, op) {
    const node = maskedNode(state, op.nodeId);
    let mask = node.mask;
    if (op.invert) mask = invertLayerMask(mask);
    if (op.enabled !== undefined) mask = { ...mask, enabled: op.enabled };
    return withNode(state, { ...node, mask });
  },
});

export interface ApplyMaskDraft {
  readonly type: 'apply-mask';
  readonly nodeId: NodeId;
}

/** Bakes a paint layer's mask into its pixels and removes the mask. */
export const applyMaskOp = defineOperation<ApplyMaskDraft>({
  type: 'apply-mask',
  schema: v.object({ nodeId: nodeIdSchema }),
  apply(state, op) {
    const node = maskedNode(state, op.nodeId);
    if (node.kind !== 'paint') throw new OperationConflictError('Only paint layers can apply their mask');
    const tiles = node.mask.enabled ? applyLayerMask(node.tiles, node.mask) : node.tiles;
    return withNode(state, { ...withoutMask(node), tiles });
  },
});
