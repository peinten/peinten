import { describe, expect, it } from 'vitest';
import { rgba8ToTiles, tilesToRgba8 } from '../raster/pixels.ts';
import { TILE_SIZE, tileKey } from './tile.ts';
import { translateTiles } from './tile-map.ts';

const big = { x: -1000, y: -1000, width: 4000, height: 4000 };

/** A 6×3 block of distinct opaque pixels at (x, y). */
function block(x: number, y: number) {
  const data = new Uint8ClampedArray(6 * 3 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
  return { tiles: rgba8ToTiles(data, 6, 3, x, y) };
}

describe('translateTiles', () => {
  it('moves pixels by any offset across tile borders', () => {
    const { tiles } = block(61, 62);
    const moved = translateTiles(tiles, 5, -3, big, 4);
    const original = tilesToRgba8(tiles, { x: 61, y: 62, width: 6, height: 3 });
    expect(tilesToRgba8(moved, { x: 66, y: 59, width: 6, height: 3 })).toEqual(original);
    expect(tilesToRgba8(moved, { x: 61, y: 62, width: 5, height: 1 }).every((v) => v === 0)).toBe(true);
  });

  it('shares whole tiles that move by whole tiles', () => {
    const { tiles } = block(0, 0);
    const moved = translateTiles(tiles, TILE_SIZE, -2 * TILE_SIZE, big, 4);
    expect(moved.get(tileKey(1, -2))).toBe(tiles.get(tileKey(0, 0)));
  });

  it('drops pixels outside the bounds and tiles left empty', () => {
    const { tiles } = block(60, 0);
    const moved = translateTiles(tiles, 0, 0, { x: 0, y: 0, width: 63, height: 100 }, 4);
    // Only the three columns left of x = 63 remain, and the second tile, now empty, is gone.
    expect([...moved.keys()]).toEqual([tileKey(0, 0)]);
    const row = tilesToRgba8(moved, { x: 60, y: 0, width: 6, height: 1 });
    expect([...row.slice(3 * 4)].every((v) => v === 0)).toBe(true);
    expect(row[3]).toBe(255);
  });

  it('moves single-channel masks', () => {
    const mask = new Uint16Array(TILE_SIZE * TILE_SIZE);
    mask[TILE_SIZE * 2 + 63] = 1234;
    const moved = translateTiles(new Map([[tileKey(0, 0), mask]]), 1, 0, big, 1);
    expect(moved.get(tileKey(1, 0))![TILE_SIZE * 2]).toBe(1234);
    expect(moved.has(tileKey(0, 0))).toBe(false);
  });
});
