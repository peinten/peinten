import { FIX15_ONE, MASK_TILE_LENGTH, RGBA_TILE_LENGTH, TILE_SIZE, tileKey } from '../tiles/tile.ts';
import { type Rect, type TileMap, translateTiles } from '../tiles/tile-map.ts';
import type { LayerMask } from './nodes.ts';

/** The fix15 value of the mask's pixels that have no tile. */
export function maskFill(mask: LayerMask): number {
  return mask.fill * FIX15_ONE;
}

/** Visibility of one pixel in 0..1. */
export function maskValue(mask: LayerMask, x: number, y: number): number {
  const tile = mask.tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
  return (tile ? tile[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)]! : maskFill(mask)) / FIX15_ONE;
}

/** Swaps shown and hidden. */
export function invertLayerMask(mask: LayerMask): LayerMask {
  const tiles = new Map<number, Uint16Array>();
  for (const [key, tile] of mask.tiles)
    tiles.set(
      key,
      tile.map((v) => FIX15_ONE - v),
    );
  return { ...mask, tiles, fill: mask.fill === 1 ? 0 : 1 };
}

/** Moves the mask with its layer; pixels that enter the bounds take the mask's fill. */
export function translateLayerMask(mask: LayerMask, dx: number, dy: number, bounds: Rect): LayerMask {
  return { ...mask, tiles: translateTiles(mask.tiles, dx, dy, bounds, 1, maskFill(mask)) };
}

/** Multiplies premultiplied pixels by the mask, which is what applying a mask to a paint layer does. */
export function applyLayerMask(tiles: TileMap, mask: LayerMask): TileMap {
  const result = new Map<number, Uint16Array>();
  for (const [key, tile] of tiles) {
    const coverage = mask.tiles.get(key);
    if (!coverage) {
      if (mask.fill === 1) result.set(key, tile);
      continue;
    }
    const out = new Uint16Array(RGBA_TILE_LENGTH);
    for (let i = 0; i < MASK_TILE_LENGTH; i++) {
      const c = coverage[i]!;
      for (let k = 0; k < 4; k++) out[i * 4 + k] = (tile[i * 4 + k]! * c) >>> 15;
    }
    if (out.some((v) => v !== 0)) result.set(key, out);
  }
  return result;
}
