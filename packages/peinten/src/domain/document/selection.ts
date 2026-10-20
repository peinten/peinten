import { FULL_MASK_TILE } from '../raster/polygon.ts';
import { isEmptyTile, MASK_TILE_LENGTH, TILE_SIZE, type TileKey, tileCoords, tileKey } from '../tiles/tile.ts';
import { forEachTileInRect, type MaskMap, type Rect, tileKeysInRect } from '../tiles/tile-map.ts';

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';
export const SELECTION_MODES: readonly SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

const ONE = 1 << 15;
const isFull = (tile: Uint16Array | undefined) => tile === FULL_MASK_TILE;

function combineTile(
  a: Uint16Array | undefined,
  b: Uint16Array | undefined,
  mode: Exclude<SelectionMode, 'replace'>,
): Uint16Array | undefined {
  switch (mode) {
    case 'add':
      if (!a || isFull(b)) return b;
      if (!b || isFull(a)) return a;
      break;
    case 'subtract':
      if (!a || isFull(b)) return undefined;
      if (!b) return a;
      break;
    case 'intersect':
      if (!a || !b) return undefined;
      if (isFull(a)) return b;
      if (isFull(b)) return a;
      break;
  }
  const out = new Uint16Array(MASK_TILE_LENGTH);
  for (let i = 0; i < MASK_TILE_LENGTH; i++) {
    const va = a![i]!;
    const vb = b![i]!;
    out[i] = mode === 'add' ? Math.max(va, vb) : mode === 'subtract' ? (va * (ONE - vb)) >>> 15 : Math.min(va, vb);
  }
  return isEmptyTile(out) ? undefined : out;
}

/** Combines an existing selection with a new shape. Returns null when the result selects nothing. */
export function combineSelection(current: MaskMap | null, shape: MaskMap, mode: SelectionMode): MaskMap | null {
  if (mode === 'replace') return shape.size ? shape : null;
  if (!current) return mode === 'add' && shape.size ? shape : null;
  const keys = new Set<TileKey>([...current.keys(), ...shape.keys()]);
  const result = new Map<TileKey, Uint16Array>();
  for (const key of keys) {
    const tile = combineTile(current.get(key), shape.get(key), mode);
    if (tile) result.set(key, tile);
  }
  return result.size ? result : null;
}

/** Selection covering the whole document. Fully covered tiles share one immutable tile. */
export function selectAllMask(bounds: Rect): MaskMap {
  return new Map(tileKeysInRect(bounds).map((key) => [key, FULL_MASK_TILE]));
}

/** Inverts the selection within the document bounds. */
export function invertMask(mask: MaskMap | null, bounds: Rect): MaskMap | null {
  const result = new Map<TileKey, Uint16Array>();
  forEachTileInRect(bounds, (tx, ty) => {
    const key = tileKey(tx, ty);
    const tile = mask?.get(key);
    if (!tile) {
      result.set(key, FULL_MASK_TILE);
      return;
    }
    if (isFull(tile)) return;
    const out = new Uint16Array(MASK_TILE_LENGTH);
    for (let i = 0; i < MASK_TILE_LENGTH; i++) out[i] = ONE - tile[i]!;
    if (!isEmptyTile(out)) result.set(key, out);
  });
  return result.size ? result : null;
}

/** Coverage of the selection at a document pixel, in 0..1. */
export function selectionCoverage(mask: MaskMap, x: number, y: number): number {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const tx = Math.floor(px / TILE_SIZE);
  const ty = Math.floor(py / TILE_SIZE);
  const tile = mask.get(tileKey(tx, ty));
  if (!tile) return 0;
  return tile[(py - ty * TILE_SIZE) * TILE_SIZE + (px - tx * TILE_SIZE)]! / ONE;
}

/** Shifts the selection by whole pixels. Coverage moved outside the document is dropped. */
export function translateMask(mask: MaskMap, dx: number, dy: number, bounds: Rect): MaskMap | null {
  const result = new Map<TileKey, Uint16Array>();
  for (const [key, tile] of mask) {
    const [tx, ty] = tileCoords(key);
    for (let py = 0; py < TILE_SIZE; py++) {
      const y = ty * TILE_SIZE + py + dy;
      if (y < bounds.y || y >= bounds.y + bounds.height) continue;
      const dty = Math.floor(y / TILE_SIZE);
      const row = (y - dty * TILE_SIZE) * TILE_SIZE;
      for (let px = 0; px < TILE_SIZE; px++) {
        const value = tile[py * TILE_SIZE + px]!;
        if (value === 0) continue;
        const x = tx * TILE_SIZE + px + dx;
        if (x < bounds.x || x >= bounds.x + bounds.width) continue;
        const dtx = Math.floor(x / TILE_SIZE);
        const target = tileKey(dtx, dty);
        let out = result.get(target);
        if (!out) {
          out = new Uint16Array(MASK_TILE_LENGTH);
          result.set(target, out);
        }
        out[row + (x - dtx * TILE_SIZE)] = value;
      }
    }
  }
  return result.size ? result : null;
}
