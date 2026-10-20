import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import { brushSettingsSchema } from '../brush/myb.ts';
import type { BrushSettings } from '../brush/settings.ts';
import { SAMPLE_STRIDE } from '../brush/stroke-samples.ts';
import type { NodeId, PaintLayer } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import type { DocState } from '../document/state.ts';
import { isEmptyTile, RGBA_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import type { TileMap } from '../tiles/tile-map.ts';
import { defineOperation, OperationConflictError } from './operation.ts';
import { StrokeRenderer, type StrokeTarget } from './stroke-renderer.ts';

const targetSchema = v.union([v.object({ nodeId: nodeIdSchema }), v.object({ selection: v.literal(true) })]);

/** Stroke input samples in the `SAMPLE_STRIDE` layout. */
export const strokeSamplesSchema = v.pipe(
  v.instance(Float32Array),
  v.check((samples) => samples.length % SAMPLE_STRIDE === 0, 'Sample count is not a multiple of the stride'),
);

export interface StrokeDraft {
  readonly type: 'stroke';
  readonly target: StrokeTarget;
  /** Fully resolved brush, including color and eraser mode. */
  readonly brush: BrushSettings;
  /** Input samples in the `SAMPLE_STRIDE` layout. */
  readonly samples: Float32Array;
  readonly seed: number;
}

export const strokeOp = defineOperation<StrokeDraft>({
  type: 'stroke',
  schema: v.object({
    target: targetSchema,
    brush: brushSettingsSchema,
    samples: strokeSamplesSchema,
    seed: v.pipe(v.number(), v.integer()),
  }) as never,
  apply(state, op, ctx) {
    const renderer = new StrokeRenderer(
      state,
      { target: op.target, brush: op.brush, seed: op.seed, clientId: op.clientId },
      ctx.mixer,
    );
    renderer.feed(op.samples);
    return renderer.commit();
  },
});

function paintLayer(state: DocState, nodeId: NodeId): PaintLayer {
  const node = state.nodes.get(nodeId);
  if (node?.kind !== 'paint') throw new OperationConflictError(`Node ${nodeId} is not a paint layer`);
  if (node.locked) throw new OperationConflictError(`Layer ${nodeId} is locked`);
  return node;
}

function withTiles(state: DocState, layer: PaintLayer, tiles: TileMap): DocState {
  return create(state, (draft) => {
    (draft.nodes.get(layer.id) as Draft<PaintLayer>).tiles = tiles as Draft<TileMap>;
  });
}

export interface ClearDraft {
  readonly type: 'clear';
  readonly nodeId: NodeId;
}

/** Clears a paint layer, or only the issuer's selected area when the issuer has a selection. */
export const clearOp = defineOperation<ClearDraft>({
  type: 'clear',
  schema: v.object({ nodeId: nodeIdSchema }),
  apply(state, op) {
    const layer = paintLayer(state, op.nodeId);
    const selection = state.selections.get(op.clientId);
    if (!selection) return withTiles(state, layer, new Map());
    const tiles = new Map(layer.tiles);
    for (const [key, coverage] of selection) {
      const tile = tiles.get(key);
      if (!tile) continue;
      const next = tile.slice();
      for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
        const keep = (1 << 15) - coverage[i]!;
        for (let c = 0; c < 4; c++) next[i * 4 + c] = (next[i * 4 + c]! * keep) >>> 15;
      }
      if (isEmptyTile(next)) tiles.delete(key);
      else tiles.set(key, next);
    }
    return withTiles(state, layer, tiles);
  },
});

export interface PutTilesDraft {
  readonly type: 'put-tiles';
  readonly nodeId: NodeId;
  /** Replacement tiles. Tiles not listed keep their content unless `replace` is set. */
  readonly tiles: readonly { readonly tx: number; readonly ty: number; readonly data: Uint16Array }[];
  readonly replace: boolean;
}

/** Writes raw tiles. Used for imported images and for results computed on the issuing client. */
export const putTilesOp = defineOperation<PutTilesDraft>({
  type: 'put-tiles',
  schema: v.object({
    nodeId: nodeIdSchema,
    tiles: v.array(
      v.object({
        tx: v.pipe(v.number(), v.integer()),
        ty: v.pipe(v.number(), v.integer()),
        data: v.pipe(
          v.instance(Uint16Array),
          v.check((data) => data.length === RGBA_TILE_LENGTH, 'Tile has the wrong size'),
        ),
      }),
    ),
    replace: v.boolean(),
  }),
  apply(state, op) {
    const layer = paintLayer(state, op.nodeId);
    const tiles = op.replace ? new Map<TileKey, Uint16Array>() : new Map(layer.tiles);
    for (const tile of op.tiles) {
      const key = tileKey(tile.tx, tile.ty);
      if (isEmptyTile(tile.data)) tiles.delete(key);
      else tiles.set(key, tile.data);
    }
    return withTiles(state, layer, tiles);
  },
});
