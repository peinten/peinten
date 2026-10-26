import { FIX15_ONE, TILE_SIZE, tileKey } from '../tiles/tile.ts';
import type { MaskMap, TileMap } from '../tiles/tile-map.ts';

interface ThumbnailImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * The thumbnail size for a document and, for each thumbnail pixel, the four document pixels it averages: a 2x2 grid
 * of samples is plenty for layer panel thumbnails and cheap enough to redo while painting.
 */
function sampleGrid(
  docWidth: number,
  docHeight: number,
  maxSize: number,
  visit: (offset: number, px: number, py: number) => void,
): { width: number; height: number } {
  const scale = Math.min(maxSize / docWidth, maxSize / docHeight, 1);
  const width = Math.max(1, Math.round(docWidth * scale));
  const height = Math.max(1, Math.round(docHeight * scale));
  const step = 1 / scale;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const px = Math.min(Math.floor((x + (sx + 0.5) / 2) * step), docWidth - 1);
          const py = Math.min(Math.floor((y + (sy + 0.5) / 2) * step), docHeight - 1);
          visit(y * width + x, px, py);
        }
      }
    }
  }
  return { width, height };
}

function tileAt<T extends Uint16Array>(tiles: TileMap<T>, px: number, py: number): T | undefined {
  return tiles.get(tileKey(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE)));
}

/** Downsamples a layer to fit `maxSize` as straight 8-bit RGBA. */
export function renderThumbnail(tiles: TileMap, docWidth: number, docHeight: number, maxSize: number): ThumbnailImage {
  const sums = new Float64Array(maxSize * maxSize * 4);
  const { width, height } = sampleGrid(docWidth, docHeight, maxSize, (offset, px, py) => {
    const tile = tileAt(tiles, px, py);
    if (!tile) return;
    const p = ((py % TILE_SIZE) * TILE_SIZE + (px % TILE_SIZE)) * 4;
    for (let c = 0; c < 4; c++) sums[offset * 4 + c]! += tile[p + c]!;
  });
  const data = new Uint8ClampedArray(width * height * 4);
  for (let o = 0; o < width * height; o++) {
    const a = sums[o * 4 + 3]!;
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) data[o * 4 + c] = (sums[o * 4 + c]! / a) * 255;
    data[o * 4 + 3] = (a / 4 / FIX15_ONE) * 255;
  }
  return { data, width, height };
}

/** Downsamples a layer mask to fit `maxSize` as opaque grayscale RGBA: white shows, black hides. */
export function renderMaskThumbnail(
  tiles: MaskMap,
  fill: number,
  docWidth: number,
  docHeight: number,
  maxSize: number,
): ThumbnailImage {
  const sums = new Float64Array(maxSize * maxSize);
  const { width, height } = sampleGrid(docWidth, docHeight, maxSize, (offset, px, py) => {
    const tile = tileAt(tiles, px, py);
    sums[offset]! += tile ? tile[(py % TILE_SIZE) * TILE_SIZE + (px % TILE_SIZE)]! : fill;
  });
  const data = new Uint8ClampedArray(width * height * 4);
  for (let o = 0; o < width * height; o++) {
    data.fill((sums[o]! / 4 / FIX15_ONE) * 255, o * 4, o * 4 + 3);
    data[o * 4 + 3] = 255;
  }
  return { data, width, height };
}
