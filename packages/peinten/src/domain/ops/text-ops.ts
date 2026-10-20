import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import type { DocNode, NodeId, PaintLayer } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import { RGBA_TILE_LENGTH, tileCoords, tileKey } from '../tiles/tile.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

export interface RasterizeNodeDraft {
  readonly type: 'rasterize-node';
  readonly nodeId: NodeId;
  /** Filled in by `prepare` on the issuing client, because text rendering differs between environments. */
  readonly tiles?: readonly { readonly tx: number; readonly ty: number; readonly data: Uint16Array }[];
}

/** Converts a text layer into a paint layer with the same id and properties. */
export const rasterizeNodeOp = defineOperation<RasterizeNodeDraft>({
  type: 'rasterize-node',
  schema: v.object({
    nodeId: nodeIdSchema,
    tiles: v.optional(
      v.array(
        v.object({
          tx: v.pipe(v.number(), v.integer()),
          ty: v.pipe(v.number(), v.integer()),
          data: v.pipe(
            v.instance(Uint16Array),
            v.check((data) => data.length === RGBA_TILE_LENGTH),
          ),
        }),
      ),
    ),
  }),
  async prepare(draft, ctx) {
    const node = ctx.state.nodes.get(draft.nodeId);
    if (node?.kind !== 'text') throw new OperationConflictError(`Node ${draft.nodeId} is not a text layer`);
    const tiles = await ctx.text.rasterize(node);
    return {
      ...draft,
      tiles: [...tiles].map(([key, data]) => {
        const [tx, ty] = tileCoords(key);
        return { tx, ty, data };
      }),
    };
  },
  apply(state, op) {
    const node = state.nodes.get(op.nodeId);
    if (node?.kind !== 'text') throw new OperationConflictError(`Node ${op.nodeId} is not a text layer`);
    if (!op.tiles) throw new OperationConflictError('rasterize-node was not prepared');
    const layer: PaintLayer = {
      kind: 'paint',
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      visible: node.visible,
      opacity: node.opacity,
      blendMode: node.blendMode,
      locked: node.locked,
      alphaLocked: false,
      tiles: new Map(op.tiles.map((tile) => [tileKey(tile.tx, tile.ty), tile.data])),
    };
    return create(state, (draft) => {
      draft.nodes.set(node.id, layer as Draft<DocNode>);
    });
  },
});
