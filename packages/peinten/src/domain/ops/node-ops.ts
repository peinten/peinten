import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import type {
  AdjustmentLayer,
  DocNode,
  GroupLayer,
  NodeId,
  NodeProps,
  PaintLayer,
  TextLayer,
} from '../document/nodes.ts';
import {
  blendModeSchema,
  filterSpecSchema,
  indexSchema,
  nameSchema,
  nodeIdSchema,
  opacitySchema,
} from '../document/schema.ts';
import { type DocState, getNode, isAncestorOrSelf } from '../document/state.ts';
import type { FilterSpec } from '../filters/filter.ts';
import { textLayerDataSchema } from '../text/schema.ts';
import type { TextLayerData } from '../text/text-layer.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

const placementSchema = {
  nodeId: nodeIdSchema,
  parentId: v.nullable(nodeIdSchema),
  index: indexSchema,
  name: nameSchema,
};

function assertNew(state: DocState, nodeId: NodeId): void {
  if (state.nodes.has(nodeId)) throw new OperationConflictError(`Node ${nodeId} already exists`);
}

function assertParent(state: DocState, parentId: NodeId | null): void {
  if (parentId === null) return;
  const parent = state.nodes.get(parentId);
  if (parent?.kind !== 'group') throw new OperationConflictError(`Parent ${parentId} is not a group`);
}

/** Children array of a draft group, or the draft root list. */
function draftChildren(draft: Draft<DocState>, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return draft.rootIds;
  return (draft.nodes.get(parentId) as Draft<GroupLayer>).childIds;
}

function insertNode(state: DocState, node: DocNode, index: number): DocState {
  return create(state, (draft) => {
    draft.nodes.set(node.id, node as Draft<DocNode>);
    const children = draftChildren(draft, node.parentId);
    children.splice(Math.min(index, children.length), 0, node.id);
  });
}

const baseProps = { visible: true, opacity: 1, blendMode: 'normal' } as const;

export interface AddLayerDraft {
  readonly type: 'add-layer';
  readonly nodeId: NodeId;
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly name: string;
}

export const addLayerOp = defineOperation<AddLayerDraft>({
  type: 'add-layer',
  schema: v.object(placementSchema),
  apply(state, op) {
    assertNew(state, op.nodeId);
    assertParent(state, op.parentId);
    const layer: PaintLayer = {
      kind: 'paint',
      id: op.nodeId,
      parentId: op.parentId,
      name: op.name,
      ...baseProps,
      locked: false,
      alphaLocked: false,
      tiles: new Map(),
    };
    return insertNode(state, layer, op.index);
  },
});

export interface AddGroupDraft {
  readonly type: 'add-group';
  readonly nodeId: NodeId;
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly name: string;
}

export const addGroupOp = defineOperation<AddGroupDraft>({
  type: 'add-group',
  schema: v.object(placementSchema),
  apply(state, op) {
    assertNew(state, op.nodeId);
    assertParent(state, op.parentId);
    const group: GroupLayer = {
      kind: 'group',
      id: op.nodeId,
      parentId: op.parentId,
      name: op.name,
      ...baseProps,
      locked: false,
      childIds: [],
      passThrough: false,
    };
    return insertNode(state, group, op.index);
  },
});

export interface AddAdjustmentLayerDraft {
  readonly type: 'add-adjustment-layer';
  readonly nodeId: NodeId;
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly name: string;
  readonly filter: FilterSpec;
}

export const addAdjustmentLayerOp = defineOperation<AddAdjustmentLayerDraft>({
  type: 'add-adjustment-layer',
  schema: v.object({ ...placementSchema, filter: filterSpecSchema }) as never,
  apply(state, op, ctx) {
    assertNew(state, op.nodeId);
    assertParent(state, op.parentId);
    const layer: AdjustmentLayer = {
      kind: 'adjustment',
      id: op.nodeId,
      parentId: op.parentId,
      name: op.name,
      ...baseProps,
      filter: parseFilter(ctx.filters, op.filter),
    };
    return insertNode(state, layer, op.index);
  },
});

export interface AddTextLayerDraft {
  readonly type: 'add-text-layer';
  readonly nodeId: NodeId;
  readonly parentId: NodeId | null;
  readonly index: number;
  readonly name: string;
  readonly text: TextLayerData;
}

export const addTextLayerOp = defineOperation<AddTextLayerDraft>({
  type: 'add-text-layer',
  schema: v.object({ ...placementSchema, text: textLayerDataSchema }),
  apply(state, op) {
    assertNew(state, op.nodeId);
    assertParent(state, op.parentId);
    const layer: TextLayer = {
      kind: 'text',
      id: op.nodeId,
      parentId: op.parentId,
      name: op.name,
      ...baseProps,
      locked: false,
      text: op.text,
    };
    return insertNode(state, layer, op.index);
  },
});

export interface RemoveNodeDraft {
  readonly type: 'remove-node';
  readonly nodeId: NodeId;
}

export const removeNodeOp = defineOperation<RemoveNodeDraft>({
  type: 'remove-node',
  schema: v.object({ nodeId: nodeIdSchema }),
  apply(state, op) {
    const node = state.nodes.get(op.nodeId);
    if (!node) throw new OperationConflictError(`Node ${op.nodeId} does not exist`);
    return create(state, (draft) => {
      const children = draftChildren(draft, node.parentId);
      children.splice(children.indexOf(op.nodeId), 1);
      const remove = (id: NodeId) => {
        const current = state.nodes.get(id)!;
        if (current.kind === 'group') for (const childId of current.childIds) remove(childId);
        draft.nodes.delete(id);
      };
      remove(op.nodeId);
    });
  },
});

export interface MoveNodeDraft {
  readonly type: 'move-node';
  readonly nodeId: NodeId;
  readonly parentId: NodeId | null;
  /** Index in the destination children after the node has been removed from its old place. */
  readonly index: number;
}

export const moveNodeOp = defineOperation<MoveNodeDraft>({
  type: 'move-node',
  schema: v.object({ nodeId: nodeIdSchema, parentId: v.nullable(nodeIdSchema), index: indexSchema }),
  apply(state, op) {
    const node = state.nodes.get(op.nodeId);
    if (!node) throw new OperationConflictError(`Node ${op.nodeId} does not exist`);
    assertParent(state, op.parentId);
    if (isAncestorOrSelf(state, op.nodeId, op.parentId)) {
      throw new OperationConflictError('A node cannot be moved into itself');
    }
    return create(state, (draft) => {
      const from = draftChildren(draft, node.parentId);
      from.splice(from.indexOf(op.nodeId), 1);
      const to = draftChildren(draft, op.parentId);
      to.splice(Math.min(op.index, to.length), 0, op.nodeId);
      draft.nodes.get(op.nodeId)!.parentId = op.parentId;
    });
  },
});

export interface UpdateNodeDraft {
  readonly type: 'update-node';
  readonly nodeId: NodeId;
  readonly props: Partial<NodeProps>;
}

/** Which props each node kind accepts. Props that do not apply to the target are ignored. */
const PROPS_BY_KIND: Record<DocNode['kind'], readonly (keyof NodeProps)[]> = {
  paint: ['name', 'visible', 'opacity', 'blendMode', 'locked', 'alphaLocked'],
  group: ['name', 'visible', 'opacity', 'blendMode', 'locked', 'passThrough'],
  adjustment: ['name', 'visible', 'opacity', 'blendMode', 'filter'],
  text: ['name', 'visible', 'opacity', 'blendMode', 'locked'],
};

export const updateNodeOp = defineOperation<UpdateNodeDraft>({
  type: 'update-node',
  schema: v.object({
    nodeId: nodeIdSchema,
    props: v.partial(
      v.object({
        name: nameSchema,
        visible: v.boolean(),
        opacity: opacitySchema,
        blendMode: blendModeSchema,
        locked: v.boolean(),
        alphaLocked: v.boolean(),
        passThrough: v.boolean(),
        filter: filterSpecSchema,
      }),
    ),
  }) as never,
  apply(state, op, ctx) {
    const node = state.nodes.get(op.nodeId);
    if (!node) throw new OperationConflictError(`Node ${op.nodeId} does not exist`);
    return create(state, (draft) => {
      const target = draft.nodes.get(op.nodeId) as unknown as Record<string, unknown>;
      for (const key of PROPS_BY_KIND[node.kind]) {
        const value = op.props[key];
        if (value === undefined) continue;
        target[key] = key === 'filter' ? parseFilter(ctx.filters, value as FilterSpec) : value;
      }
    });
  },
});

export interface UpdateTextDraft {
  readonly type: 'update-text';
  readonly nodeId: NodeId;
  readonly text: Partial<TextLayerData>;
}

export const updateTextOp = defineOperation<UpdateTextDraft>({
  type: 'update-text',
  schema: v.object({ nodeId: nodeIdSchema, text: v.partial(textLayerDataSchema as never) }) as never,
  apply(state, op) {
    const node = getNode(state, op.nodeId);
    if (node.kind !== 'text') throw new OperationConflictError(`Node ${op.nodeId} is not a text layer`);
    return create(state, (draft) => {
      const target = draft.nodes.get(op.nodeId) as Draft<TextLayer>;
      target.text = { ...node.text, ...op.text } as Draft<TextLayerData>;
    });
  },
});

export interface DuplicateNodeDraft {
  readonly type: 'duplicate-node';
  readonly nodeId: NodeId;
  /** Id of the copy. Descendants of a duplicated group get `${newNodeId}/${originalId}`. */
  readonly newNodeId: NodeId;
}

export const duplicateNodeOp = defineOperation<DuplicateNodeDraft>({
  type: 'duplicate-node',
  schema: v.object({ nodeId: nodeIdSchema, newNodeId: nodeIdSchema }),
  apply(state, op) {
    const source = state.nodes.get(op.nodeId);
    if (!source) throw new OperationConflictError(`Node ${op.nodeId} does not exist`);
    assertNew(state, op.newNodeId);
    const copies: DocNode[] = [];
    const copy = (node: DocNode, id: NodeId, parentId: NodeId | null): void => {
      if (node.kind === 'group') {
        const childIds = node.childIds.map((childId) => `${op.newNodeId}/${childId}`);
        copies.push({ ...node, id, parentId, childIds });
        node.childIds.forEach((childId, i) => {
          copy(state.nodes.get(childId)!, childIds[i]!, id);
        });
        return;
      }
      // Tiles are immutable, so the copy can share them.
      copies.push({ ...node, id, parentId });
    };
    copy(source, op.newNodeId, source.parentId);
    const top = copies[0]!;
    copies[0] = { ...top, name: `${source.name} copy` };
    return create(state, (draft) => {
      for (const node of copies) draft.nodes.set(node.id, node as Draft<DocNode>);
      const siblings = draftChildren(draft, source.parentId);
      siblings.splice(siblings.indexOf(op.nodeId) + 1, 0, op.newNodeId);
    });
  },
});

function parseFilter(filters: { parse(input: unknown): FilterSpec }, input: FilterSpec): FilterSpec {
  try {
    return filters.parse(input);
  } catch (error) {
    throw new OperationConflictError(`Invalid filter: ${(error as Error).message}`);
  }
}
