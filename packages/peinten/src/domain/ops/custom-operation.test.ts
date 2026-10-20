import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { opContext } from '../../../test/helpers.ts';
import type { PaintLayer } from '../document/nodes.ts';
import { createDocState } from '../document/state.ts';
import { FIX15_ONE, RGBA_TILE_LENGTH, TILE_SIZE, tileCoords, tileKey } from '../tiles/tile.ts';
import { tileKeysInRect } from '../tiles/tile-map.ts';
import { coreOperations } from './core.ts';
import { defineOperation, OperationConflictError } from './operation.ts';
import { OperationRegistry } from './registry.ts';

// The fill-rect example of the "Editing and undo" docs page, with imports from the source instead of the entries.
interface FillRectDraft {
  readonly type: 'fill-rect';
  readonly nodeId: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Straight RGBA in 0..1. */
  readonly color: readonly [number, number, number, number];
}

const int = v.pipe(v.number(), v.integer());
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

const fillRect = defineOperation<FillRectDraft>({
  type: 'fill-rect',
  schema: v.object({
    nodeId: v.string(),
    rect: v.object({ x: int, y: int, width: v.pipe(int, v.minValue(1)), height: v.pipe(int, v.minValue(1)) }),
    color: v.tuple([unit, unit, unit, unit]),
  }),
  apply(state, op) {
    const layer = state.nodes.get(op.nodeId);
    if (layer?.kind !== 'paint') throw new OperationConflictError('Not a paint layer');
    const { x, y, width, height } = op.rect;
    const [r, g, b, a] = op.color;
    // Tiles hold premultiplied fix15 values.
    const alpha = Math.round(a * FIX15_ONE);
    const pixel = [Math.round(r * alpha), Math.round(g * alpha), Math.round(b * alpha), alpha];
    const tiles = new Map(layer.tiles);
    for (const key of tileKeysInRect(op.rect)) {
      const [tx, ty] = tileCoords(key);
      // Committed tiles are shared with earlier states, so write into a copy.
      const tile = tiles.get(key)?.slice() ?? new Uint16Array(RGBA_TILE_LENGTH);
      const left = Math.max(x - tx * TILE_SIZE, 0);
      const right = Math.min(x + width - tx * TILE_SIZE, TILE_SIZE);
      for (let py = Math.max(y - ty * TILE_SIZE, 0); py < Math.min(y + height - ty * TILE_SIZE, TILE_SIZE); py++)
        for (let px = left; px < right; px++) tile.set(pixel, (py * TILE_SIZE + px) * 4);
      tiles.set(key, tile);
    }
    const nodes = new Map(state.nodes);
    nodes.set(layer.id, { ...layer, tiles });
    return { ...state, nodes };
  },
});

describe('custom operations', () => {
  it('fills pixels across tile borders without touching committed tiles', async () => {
    const registry = new OperationRegistry([...coreOperations, fillRect]);
    const before = createDocState(256, 256, 'L');
    const op = registry.parse({
      type: 'fill-rect',
      id: 'o',
      clientId: 'me',
      nodeId: 'L',
      rect: { x: 60, y: 10, width: 8, height: 2 },
      color: [1, 0, 0, 0.5],
    });
    const after = await registry.get('fill-rect').apply(before, op, opContext);
    const tiles = (after.nodes.get('L') as PaintLayer).tiles;
    expect([...tiles.keys()].sort()).toEqual([tileKey(0, 0), tileKey(1, 0)].sort());
    expect([...tiles.get(tileKey(1, 0))!.slice((10 * TILE_SIZE + 3) * 4, (10 * TILE_SIZE + 4) * 4)]).toEqual([
      16384, 0, 0, 16384,
    ]);
    expect(tiles.get(tileKey(1, 0))![(10 * TILE_SIZE + 4) * 4 + 3]).toBe(0);
    expect((before.nodes.get('L') as PaintLayer).tiles.size).toBe(0);
  });
});
