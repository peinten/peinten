import { MASK_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import type { TileMap } from '../tiles/tile-map.ts';
import { FULL_MASK_TILE } from './polygon.ts';

export interface FloodOptions {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  /** Maximum per-channel difference in 0..1 for a pixel to match the seed color. */
  readonly tolerance: number;
  /** When false, every matching pixel in the document is selected, not only connected ones. */
  readonly contiguous: boolean;
}

function pixel(tiles: TileMap, x: number, y: number, out: Uint16Array): void {
  const tile = tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
  if (!tile) {
    out.fill(0);
    return;
  }
  const p = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * 4;
  out[0] = tile[p]!;
  out[1] = tile[p + 1]!;
  out[2] = tile[p + 2]!;
  out[3] = tile[p + 3]!;
}

/** Selects pixels similar to the seed pixel (magic wand). Returns fix15 mask tiles with hard edges. */
export function floodSelect(tiles: TileMap, options: FloodOptions): Map<TileKey, Uint16Array> {
  const { width, height } = options;
  const result = new Map<TileKey, Uint16Array>();
  if (options.x < 0 || options.y < 0 || options.x >= width || options.y >= height) return result;
  const seed = new Uint16Array(4);
  const current = new Uint16Array(4);
  pixel(tiles, Math.floor(options.x), Math.floor(options.y), seed);
  const limit = options.tolerance * (1 << 15);
  const matches = (x: number, y: number) => {
    pixel(tiles, x, y, current);
    for (let c = 0; c < 4; c++) if (Math.abs(current[c]! - seed[c]!) > limit) return false;
    return true;
  };
  const mark = (x: number, y: number) => {
    const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    let tile = result.get(key);
    if (!tile) {
      tile = new Uint16Array(MASK_TILE_LENGTH);
      result.set(key, tile);
    }
    tile[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)] = 1 << 15;
  };

  if (!options.contiguous) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (matches(x, y)) mark(x, y);
  } else {
    // Scanline flood fill keeps the stack small compared to per-pixel recursion.
    const visited = new Uint8Array(width * height);
    const stack: number[] = [Math.floor(options.x), Math.floor(options.y)];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      while (x > 0 && !visited[y * width + x - 1] && matches(x - 1, y)) x--;
      let spanUp = false;
      let spanDown = false;
      for (; x < width && !visited[y * width + x] && matches(x, y); x++) {
        visited[y * width + x] = 1;
        mark(x, y);
        if (y > 0) {
          const up = !visited[(y - 1) * width + x] && matches(x, y - 1);
          if (up && !spanUp) stack.push(x, y - 1);
          spanUp = up;
        }
        if (y < height - 1) {
          const down = !visited[(y + 1) * width + x] && matches(x, y + 1);
          if (down && !spanDown) stack.push(x, y + 1);
          spanDown = down;
        }
      }
    }
  }
  for (const [key, tile] of result) if (tile.every((v) => v === 1 << 15)) result.set(key, FULL_MASK_TILE);
  return result;
}
