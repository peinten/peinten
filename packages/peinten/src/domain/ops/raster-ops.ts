import { create, type Draft } from 'mutative';
import * as v from 'valibot';
import { brushSettingsSchema } from '../brush/myb.ts';
import type { BrushSettings } from '../brush/settings.ts';
import { SAMPLE_STRIDE } from '../brush/stroke-samples.ts';
import type { NodeId, PaintLayer } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import type { DocState } from '../document/state.ts';
import {
  FIX15_ONE,
  isEmptyTile,
  RGBA_TILE_LENGTH,
  TILE_SIZE,
  type TileKey,
  tileCoords,
  tileKey,
} from '../tiles/tile.ts';
import { intersectRect, type Rect, type TileMap, tileKeysInRect } from '../tiles/tile-map.ts';
import { defineOperation, OperationConflictError } from './operation.ts';
import { StrokeRenderer, type StrokeTarget } from './stroke-renderer.ts';

const targetSchema = v.union([
  v.object({ nodeId: nodeIdSchema }),
  v.object({ maskOf: nodeIdSchema }),
  v.object({ selection: v.literal(true) }),
]);

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
  // Version 2 added layer masks as a target.
  version: 2,
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
        const keep = FIX15_ONE - coverage[i]!;
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
  /** Tiles holding the new pixels. */
  readonly tiles: readonly { readonly tx: number; readonly ty: number; readonly data: Uint16Array }[];
  /** Clears the layer before writing. */
  readonly replace: boolean;
  /**
   * The pixels to write: inside it the tiles' pixels replace the layer's, transparent where no tile is given, and
   * outside it the layer keeps its pixels. Without it, each listed tile replaces a whole tile.
   */
  readonly rect?: Rect;
}

const intSchema = v.pipe(v.number(), v.integer());
const sizeSchema = v.pipe(intSchema, v.minValue(1));

/** Writes raw tiles. Used for imported images and for results computed on the issuing client. */
export const putTilesOp = defineOperation<PutTilesDraft>({
  type: 'put-tiles',
  // Version 2 added `rect`; peers without it would overwrite whole tiles.
  version: 2,
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
    rect: v.optional(v.object({ x: intSchema, y: intSchema, width: sizeSchema, height: sizeSchema })),
  }),
  apply(state, op) {
    const layer = paintLayer(state, op.nodeId);
    const tiles = op.replace ? new Map<TileKey, Uint16Array>() : new Map(layer.tiles);
    const set = (key: TileKey, tile: Uint16Array | undefined) => {
      if (!tile || isEmptyTile(tile)) tiles.delete(key);
      else tiles.set(key, tile);
    };
    const given = new Map(op.tiles.map((tile) => [tileKey(tile.tx, tile.ty), tile.data]));
    if (!op.rect) {
      for (const [key, data] of given) set(key, data);
      return withTiles(state, layer, tiles);
    }
    for (const key of tileKeysInRect(op.rect)) {
      const [tx, ty] = tileCoords(key);
      const part = intersectRect(op.rect, {
        x: tx * TILE_SIZE,
        y: ty * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      })!;
      const incoming = given.get(key);
      if (part.width === TILE_SIZE && part.height === TILE_SIZE) {
        set(key, incoming);
        continue;
      }
      // Committed tiles are shared, so the partly written tile is a copy.
      const merged = tiles.get(key)?.slice() ?? new Uint16Array(RGBA_TILE_LENGTH);
      for (let y = part.y; y < part.y + part.height; y++) {
        const from = ((y - ty * TILE_SIZE) * TILE_SIZE + (part.x - tx * TILE_SIZE)) * 4;
        const to = from + part.width * 4;
        if (incoming) merged.set(incoming.subarray(from, to), from);
        else merged.fill(0, from, to);
      }
      set(key, merged);
    }
    return withTiles(state, layer, tiles);
  },
});
