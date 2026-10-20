import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import type { NodeId, PaintLayer } from '../document/nodes.ts';
import { filterSpecSchema, nodeIdSchema } from '../document/schema.ts';
import type { FilterSpec } from '../filters/filter.ts';
import { inflateRect, intersectRect, type TileMap, tileMapBounds } from '../tiles/tile-map.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

export interface ApplyFilterDraft {
  readonly type: 'apply-filter';
  readonly nodeId: NodeId;
  readonly filter: FilterSpec;
}

/**
 * Applies a filter destructively to a paint layer, limited to the issuer's selection when there is one.
 * The kernel runs on the GPU with integer math, so every peer computes identical pixels.
 */
export const applyFilterOp = defineOperation<ApplyFilterDraft>({
  type: 'apply-filter',
  schema: v.object({ nodeId: nodeIdSchema, filter: filterSpecSchema }) as never,
  async apply(state, op, ctx) {
    const layer = state.nodes.get(op.nodeId);
    if (layer?.kind !== 'paint') throw new OperationConflictError('Filters apply to paint layers only');
    if (layer.locked) throw new OperationConflictError(`Layer ${layer.id} is locked`);
    let filter: FilterSpec;
    try {
      filter = ctx.filters.parse(op.filter);
    } catch (error) {
      throw new OperationConflictError(`Invalid filter: ${(error as Error).message}`);
    }
    const doc = { x: 0, y: 0, width: state.width, height: state.height };
    const selection = state.selections.get(op.clientId) ?? null;
    const content = selection ? tileMapBounds(selection) : tileMapBounds(layer.tiles);
    if (!content) return state;
    const region = intersectRect(selection ? content : inflateRect(content, ctx.filters.margin(filter)), doc);
    if (!region) return state;
    const tiles = await ctx.filterExecutor.apply({ tiles: layer.tiles, region, bounds: doc, filter, mask: selection });
    return create(state, (draft) => {
      (draft.nodes.get(layer.id) as Draft<PaintLayer>).tiles = tiles as Draft<TileMap>;
    });
  },
});
