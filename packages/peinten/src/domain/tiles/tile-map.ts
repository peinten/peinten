import { type MaskTile, type RgbaTile, TILE_SIZE, type TileKey, tileCoords, tileKey } from './tile.ts';

/** Sparse, copy-on-write tile storage. Missing keys mean fully transparent tiles. */
export type TileMap<T extends Uint16Array = RgbaTile> = ReadonlyMap<TileKey, T>;

export type MaskMap = TileMap<MaskTile>;

/** Axis-aligned integer rectangle in document pixels. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Calls `visit` for every tile coordinate that intersects the rectangle. */
export function forEachTileInRect(rect: Rect, visit: (tx: number, ty: number) => void): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const tx0 = Math.floor(rect.x / TILE_SIZE);
  const ty0 = Math.floor(rect.y / TILE_SIZE);
  const tx1 = Math.floor((rect.x + rect.width - 1) / TILE_SIZE);
  const ty1 = Math.floor((rect.y + rect.height - 1) / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) visit(tx, ty);
  }
}

/** Returns the pixel bounds covered by the tiles in the map, or null when the map is empty. */
export function tileMapBounds(tiles: TileMap<Uint16Array>): Rect | null {
  if (tiles.size === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const key of tiles.keys()) {
    const [tx, ty] = tileCoords(key);
    minX = Math.min(minX, tx);
    minY = Math.min(minY, ty);
    maxX = Math.max(maxX, tx);
    maxY = Math.max(maxY, ty);
  }
  return {
    x: minX * TILE_SIZE,
    y: minY * TILE_SIZE,
    width: (maxX - minX + 1) * TILE_SIZE,
    height: (maxY - minY + 1) * TILE_SIZE,
  };
}
/** Converts a rectangle to the tile keys it touches. */
export function tileKeysInRect(rect: Rect): TileKey[] {
  const keys: TileKey[] = [];
  forEachTileInRect(rect, (tx, ty) => keys.push(tileKey(tx, ty)));
  return keys;
}

/** Returns the union of two rectangles. */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Returns the intersection of two rectangles, or null when they do not overlap. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Grows a rectangle by `margin` pixels on every side. */
export function inflateRect(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}
