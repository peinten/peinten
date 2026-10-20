import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import type { NodeId, PaintLayer } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import { type WarpMesh, warpTiles } from '../raster/warp.ts';
import type { Rect, TileMap } from '../tiles/tile-map.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

const finite = v.pipe(v.number(), v.finite());
const MAX_MESH_CELLS = 128 * 128;

export interface WarpDraft {
  readonly type: 'warp';
  readonly nodeId: NodeId;
  /** Source rectangle in document pixels. Content outside the issuer's selection, if any, stays in place. */
  readonly source: Rect;
  readonly mesh: WarpMesh;
}

/** Moves the selected content of a paint layer through a mesh. The issuer's selection moves with it. */
export const warpOp = defineOperation<WarpDraft>({
  type: 'warp',
  schema: v.object({
    nodeId: nodeIdSchema,
    source: v.object({
      x: v.pipe(v.number(), v.integer()),
      y: v.pipe(v.number(), v.integer()),
      width: v.pipe(v.number(), v.integer(), v.minValue(1)),
      height: v.pipe(v.number(), v.integer(), v.minValue(1)),
    }),
    mesh: v.pipe(
      v.object({
        cols: v.pipe(v.number(), v.integer(), v.minValue(1)),
        rows: v.pipe(v.number(), v.integer(), v.minValue(1)),
        points: v.array(finite),
      }),
      v.check(
        (mesh) =>
          mesh.cols * mesh.rows <= MAX_MESH_CELLS && mesh.points.length === (mesh.cols + 1) * (mesh.rows + 1) * 3,
        'Mesh size does not match its point count',
      ),
    ),
  }),
  apply(state, op) {
    const layer = state.nodes.get(op.nodeId);
    if (layer?.kind !== 'paint') throw new OperationConflictError('Only paint layers can be warped');
    if (layer.locked) throw new OperationConflictError(`Layer ${layer.id} is locked`);
    const bounds = { x: 0, y: 0, width: state.width, height: state.height };
    const selection = state.selections.get(op.clientId) ?? null;
    const tiles = warpTiles(layer.tiles, op.source, op.mesh, selection, bounds, 4);
    const next = create(state, (draft) => {
      (draft.nodes.get(layer.id) as Draft<PaintLayer>).tiles = tiles as Draft<TileMap>;
    });
    if (!selection) return next;
    const selections = new Map(next.selections);
    const moved = warpTiles(selection, op.source, op.mesh, null, bounds, 1);
    if (moved.size) selections.set(op.clientId, moved);
    else selections.delete(op.clientId);
    return { ...next, selections };
  },
});
