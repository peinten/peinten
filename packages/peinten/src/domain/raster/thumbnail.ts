import { TILE_SIZE, tileKey } from '../tiles/tile.ts';
import type { TileMap } from '../tiles/tile-map.ts';

/**
 * Downsamples a layer to fit `maxSize` as straight 8-bit RGBA. Each output pixel averages a 2x2 grid of samples,
 * which is plenty for layer panel thumbnails and cheap enough to redo while painting.
 */
export function renderThumbnail(
  tiles: TileMap,
  docWidth: number,
  docHeight: number,
  maxSize: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(maxSize / docWidth, maxSize / docHeight, 1);
  const width = Math.max(1, Math.round(docWidth * scale));
  const height = Math.max(1, Math.round(docHeight * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  const step = 1 / scale;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = Math.min(Math.floor((x + (sx + 0.5) / 2) * step), docWidth - 1);
          const py = Math.min(Math.floor((y + (sy + 0.5) / 2) * step), docHeight - 1);
          const tile = tiles.get(tileKey(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE)));
          if (!tile) continue;
          const p = ((py % TILE_SIZE) * TILE_SIZE + (px % TILE_SIZE)) * 4;
          r += tile[p]!;
          g += tile[p + 1]!;
          b += tile[p + 2]!;
          a += tile[p + 3]!;
        }
      }
      if (a === 0) continue;
      const o = (y * width + x) * 4;
      data[o] = (r / a) * 255;
      data[o + 1] = (g / a) * 255;
      data[o + 2] = (b / a) * 255;
      data[o + 3] = (a / 4 / 32768) * 255;
    }
  }
  return { data, width, height };
}
