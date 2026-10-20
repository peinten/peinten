import { TILE_SIZE, tileCoords } from '../tiles/tile.ts';
import type { Rect, TileMap } from '../tiles/tile-map.ts';

/**
 * Tight bounds of the non-transparent pixels. `channels` is 4 for RGBA tiles (alpha is checked) and 1 for masks.
 * Returns null when everything is transparent.
 */
export function contentBounds(tiles: TileMap<Uint16Array>, channels: 1 | 4): Rect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [key, tile] of tiles) {
    const [tx, ty] = tileCoords(key);
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        if (tile[(y * TILE_SIZE + x) * channels + channels - 1] === 0) continue;
        const px = tx * TILE_SIZE + x;
        const py = ty * TILE_SIZE + y;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  return minX > maxX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
