import { FIX15_ONE, isEmptyTile, RGBA_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import { forEachTileInRect, type MaskMap, type Rect, type TileMap } from '../tiles/tile-map.ts';

/** Converts straight 8-bit RGBA pixels placed at (x, y) into premultiplied fix15 tiles. Empty tiles are omitted. */
export function rgba8ToTiles(
  data: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): Map<TileKey, Uint16Array> {
  const tiles = new Map<TileKey, Uint16Array>();
  forEachTileInRect({ x, y, width, height }, (tx, ty) => {
    const tile = new Uint16Array(RGBA_TILE_LENGTH);
    for (let py = 0; py < TILE_SIZE; py++) {
      const sy = ty * TILE_SIZE + py - y;
      if (sy < 0 || sy >= height) continue;
      for (let px = 0; px < TILE_SIZE; px++) {
        const sx = tx * TILE_SIZE + px - x;
        if (sx < 0 || sx >= width) continue;
        const s = (sy * width + sx) * 4;
        const a = data[s + 3]!;
        if (a === 0) continue;
        const d = (py * TILE_SIZE + px) * 4;
        const alpha = Math.round((a / 255) * FIX15_ONE);
        tile[d] = Math.round((data[s]! / 255) * alpha);
        tile[d + 1] = Math.round((data[s + 1]! / 255) * alpha);
        tile[d + 2] = Math.round((data[s + 2]! / 255) * alpha);
        tile[d + 3] = alpha;
      }
    }
    if (!isEmptyTile(tile)) tiles.set(tileKey(tx, ty), tile);
  });
  return tiles;
}

/** Reads the rectangle out of premultiplied fix15 tiles as straight 8-bit RGBA. */
export function tilesToRgba8(tiles: TileMap, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  forEachTileInRect(rect, (tx, ty) => {
    const tile = tiles.get(tileKey(tx, ty));
    if (!tile) return;
    for (let py = 0; py < TILE_SIZE; py++) {
      const dy = ty * TILE_SIZE + py - rect.y;
      if (dy < 0 || dy >= rect.height) continue;
      for (let px = 0; px < TILE_SIZE; px++) {
        const dx = tx * TILE_SIZE + px - rect.x;
        if (dx < 0 || dx >= rect.width) continue;
        const s = (py * TILE_SIZE + px) * 4;
        const a = tile[s + 3]!;
        if (a === 0) continue;
        const d = (dy * rect.width + dx) * 4;
        out[d] = (tile[s]! / a) * 255 + 0.5;
        out[d + 1] = (tile[s + 1]! / a) * 255 + 0.5;
        out[d + 2] = (tile[s + 2]! / a) * 255 + 0.5;
        out[d + 3] = (a / FIX15_ONE) * 255 + 0.5;
      }
    }
  });
  return out;
}

/** Reads the rectangle out of fix15 mask tiles as 8-bit coverage, one byte per pixel; missing tiles read as `fill`. */
export function maskTilesToGray8(tiles: MaskMap, rect: Rect, fill: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.width * rect.height).fill((fill / FIX15_ONE) * 255 + 0.5);
  forEachTileInRect(rect, (tx, ty) => {
    const tile = tiles.get(tileKey(tx, ty));
    if (!tile) return;
    for (let py = 0; py < TILE_SIZE; py++) {
      const dy = ty * TILE_SIZE + py - rect.y;
      if (dy < 0 || dy >= rect.height) continue;
      for (let px = 0; px < TILE_SIZE; px++) {
        const dx = tx * TILE_SIZE + px - rect.x;
        if (dx >= 0 && dx < rect.width)
          out[dy * rect.width + dx] = (tile[py * TILE_SIZE + px]! / FIX15_ONE) * 255 + 0.5;
      }
    }
  });
  return out;
}
