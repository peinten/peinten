import { isUniformTile, type MaskTile, type RgbaTile, TILE_SIZE, type TileKey, tileCoords, tileKey } from './tile.ts';

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

/**
 * Moves tiles by whole pixels and keeps only what lands inside `bounds`. `channels` is 4 for RGBA tiles and 1 for
 * masks. `fill` is the value of every pixel without a tile (0 for layers and selections, `FIX15_ONE` for a layer mask
 * that reveals by default); tiles left at that value are dropped. Tiles that move by whole tiles and stay inside
 * `bounds` are shared instead of copied.
 */
export function translateTiles<T extends Uint16Array>(
  tiles: TileMap<T>,
  dx: number,
  dy: number,
  bounds: Rect,
  channels: 1 | 4,
  fill = 0,
): Map<TileKey, T> {
  const result = new Map<TileKey, T>();
  const copies = new Set<TileKey>();
  const aligned = dx % TILE_SIZE === 0 && dy % TILE_SIZE === 0;
  for (const [key, tile] of tiles) {
    const [tx, ty] = tileCoords(key);
    const moved = { x: tx * TILE_SIZE + dx, y: ty * TILE_SIZE + dy, width: TILE_SIZE, height: TILE_SIZE };
    const visible = intersectRect(moved, bounds);
    if (!visible) continue;
    // Moving by whole tiles maps each tile onto exactly one target, so whole tiles can be reused as they are.
    if (aligned && visible.width === TILE_SIZE && visible.height === TILE_SIZE) {
      result.set(tileKey(tx + dx / TILE_SIZE, ty + dy / TILE_SIZE), tile);
      continue;
    }
    forEachTileInRect(visible, (ttx, tty) => {
      const target = { x: ttx * TILE_SIZE, y: tty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
      const part = intersectRect(visible, target)!;
      const targetKey = tileKey(ttx, tty);
      let out = result.get(targetKey);
      if (!out) {
        out = new Uint16Array(TILE_SIZE * TILE_SIZE * channels).fill(fill) as T;
        result.set(targetKey, out);
        copies.add(targetKey);
      }
      const rowLength = part.width * channels;
      for (let y = part.y; y < part.y + part.height; y++) {
        const from = ((y - moved.y) * TILE_SIZE + (part.x - moved.x)) * channels;
        const to = ((y - target.y) * TILE_SIZE + (part.x - target.x)) * channels;
        out.set(tile.subarray(from, from + rowLength), to);
      }
    });
  }
  for (const key of copies) if (isUniformTile(result.get(key)!, fill)) result.delete(key);
  return result;
}
