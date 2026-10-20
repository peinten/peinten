import { FIX15_ONE, MASK_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import type { Rect } from '../tiles/tile-map.ts';

/** A tile fully covered by a mask. Shared by reference; tiles are immutable. */
export const FULL_MASK_TILE: Uint16Array = new Uint16Array(MASK_TILE_LENGTH).fill(FIX15_ONE);

/**
 * Rasterizes a closed polygon into fix15 coverage tiles with exact-area anti-aliasing.
 * The algorithm accumulates signed area per pixel and integrates along each row (the approach of font-rs).
 * Rows are processed one tile band at a time so memory stays proportional to the polygon width.
 * Fully covered tiles reuse `FULL_MASK_TILE`.
 *
 * @param points flat [x0, y0, x1, y1, ...] in document pixels
 */
export function rasterizePolygon(points: ArrayLike<number>, clip: Rect, antialias = true): Map<TileKey, Uint16Array> {
  const tiles = new Map<TileKey, Uint16Array>();
  const n = points.length >> 1;
  if (n < 3) return tiles;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, points[i * 2]!);
    maxX = Math.max(maxX, points[i * 2]!);
    minY = Math.min(minY, points[i * 2 + 1]!);
    maxY = Math.max(maxY, points[i * 2 + 1]!);
  }
  const tx0 = Math.floor(Math.max(minX, clip.x) / TILE_SIZE);
  const tx1 = Math.floor((Math.min(maxX, clip.x + clip.width) - 1e-9) / TILE_SIZE);
  const ty0 = Math.floor(Math.max(minY, clip.y) / TILE_SIZE);
  const ty1 = Math.floor((Math.min(maxY, clip.y + clip.height) - 1e-9) / TILE_SIZE);
  if (tx0 > tx1 || ty0 > ty1) return tiles;

  // Local coordinate system: x relative to the left edge of tile column tx0, with one spare column on the right.
  const originX = tx0 * TILE_SIZE;
  const width = (tx1 - tx0 + 1) * TILE_SIZE;
  const stride = width + 2;
  const acc = new Float32Array(stride * TILE_SIZE);

  for (let ty = ty0; ty <= ty1; ty++) {
    acc.fill(0);
    const originY = ty * TILE_SIZE;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      drawLine(
        acc,
        stride,
        width,
        points[i * 2]! - originX,
        points[i * 2 + 1]! - originY,
        points[j * 2]! - originX,
        points[j * 2 + 1]! - originY,
      );
    }
    emitBand(acc, stride, tx0, tx1, ty, antialias, tiles);
  }
  return tiles;
}

function emitBand(
  acc: Float32Array,
  stride: number,
  tx0: number,
  tx1: number,
  ty: number,
  antialias: boolean,
  out: Map<TileKey, Uint16Array>,
): void {
  const columns = tx1 - tx0 + 1;
  const bandTiles: (Uint16Array | null)[] = new Array(columns).fill(null);
  const full: boolean[] = new Array(columns).fill(true);
  for (let y = 0; y < TILE_SIZE; y++) {
    let sum = 0;
    const row = y * stride;
    for (let c = 0; c < columns; c++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        sum += acc[row + c * TILE_SIZE + x]!;
        let coverage = Math.min(Math.abs(sum), 1);
        if (!antialias) coverage = coverage >= 0.5 ? 1 : 0;
        const value = Math.round(coverage * 32768);
        if (value !== 32768) full[c] = false;
        if (value === 0) continue;
        let tile = bandTiles[c];
        if (!tile) {
          tile = new Uint16Array(MASK_TILE_LENGTH);
          bandTiles[c] = tile;
        }
        tile[y * TILE_SIZE + x] = value;
      }
    }
  }
  for (let c = 0; c < columns; c++) {
    const tile = bandTiles[c];
    if (!tile) continue;
    out.set(tileKey(tx0 + c, ty), full[c] ? FULL_MASK_TILE : tile);
  }
}

/** Accumulates the signed area of one edge into the band buffer. Adapted from font-rs's `draw_line`. */
function drawLine(
  acc: Float32Array,
  stride: number,
  width: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  if (Math.abs(ay - by) <= 1e-9) return;
  const dir = ay < by ? 1 : -1;
  const p0x = dir > 0 ? ax : bx;
  const p0y = dir > 0 ? ay : by;
  const p1x = dir > 0 ? bx : ax;
  const p1y = dir > 0 ? by : ay;
  const dxdy = (p1x - p0x) / (p1y - p0y);
  let x = p0x;
  if (p0y < 0) x -= p0y * dxdy;
  const yStart = Math.max(Math.floor(p0y), 0);
  const yEnd = Math.min(Math.ceil(p1y), TILE_SIZE);
  for (let y = yStart; y < yEnd; y++) {
    const line = y * stride;
    const dy = Math.min(y + 1, p1y) - Math.max(y, p0y);
    const xNext = x + dxdy * dy;
    const d = dy * dir;
    // Parts of the edge left of the band still affect the winding, so they are clamped onto column 0.
    const cx = Math.min(Math.max(x, 0), width);
    const cxNext = Math.min(Math.max(xNext, 0), width);
    const x0 = Math.min(cx, cxNext);
    const x1 = Math.max(cx, cxNext);
    const x0Floor = Math.floor(x0);
    const x0i = x0Floor;
    const x1Ceil = Math.ceil(x1);
    const x1i = x1Ceil;
    if (x1i <= x0i + 1) {
      const xmf = 0.5 * (cx + cxNext) - x0Floor;
      acc[line + x0i]! += d - d * xmf;
      acc[line + x0i + 1]! += d * xmf;
    } else {
      const s = 1 / (x1 - x0);
      const x0f = x0 - x0Floor;
      const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
      const x1f = x1 - x1Ceil + 1;
      const am = 0.5 * s * x1f * x1f;
      acc[line + x0i]! += d * a0;
      if (x1i === x0i + 2) {
        acc[line + x0i + 1]! += d * (1 - a0 - am);
      } else {
        const a1 = s * (1.5 - x0f);
        acc[line + x0i + 1]! += d * (a1 - a0);
        for (let xi = x0i + 2; xi < x1i - 1; xi++) acc[line + xi]! += d * s;
        const a2 = a1 + (x1i - x0i - 3) * s;
        acc[line + x1i - 1]! += d * (1 - a2 - am);
      }
      acc[line + x1i]! += d * am;
    }
    x = xNext;
  }
}

/** Polygon approximating an ellipse, with enough segments for sub-pixel accuracy. */
export function ellipsePolygon(cx: number, cy: number, rx: number, ry: number): number[] {
  const segments = Math.max(32, Math.ceil(Math.PI * (Math.abs(rx) + Math.abs(ry))));
  const points: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return points;
}
