import { isEmptyTile, MASK_TILE_LENGTH, RGBA_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import { forEachTileInRect, intersectRect, type MaskMap, type Rect, type TileMap } from '../tiles/tile-map.ts';

/**
 * Regular grid over the source rectangle. Vertex (i, j) maps the source point at (i/cols, j/rows) of the rectangle
 * to the homogeneous destination point (x, y, w); its screen position is (x/w, y/w).
 * Affine, perspective and free-form mesh transforms are all expressed with this one structure.
 */
export interface WarpMesh {
  readonly cols: number;
  readonly rows: number;
  /** (cols + 1) * (rows + 1) vertices of [x, y, w], row-major. */
  readonly points: readonly number[];
}

const ONE = 1 << 15;

/** Copies the source rectangle out of the tiles, weighted by the clip coverage. */
function extract(tiles: TileMap<Uint16Array>, rect: Rect, clip: MaskMap | null, channels: number): Uint16Array {
  const out = new Uint16Array(rect.width * rect.height * channels);
  forEachTileInRect(rect, (tx, ty) => {
    const key = tileKey(tx, ty);
    const tile = tiles.get(key);
    if (!tile) return;
    const coverage = clip?.get(key);
    if (clip && !coverage) return;
    for (let py = 0; py < TILE_SIZE; py++) {
      const y = ty * TILE_SIZE + py - rect.y;
      if (y < 0 || y >= rect.height) continue;
      for (let px = 0; px < TILE_SIZE; px++) {
        const x = tx * TILE_SIZE + px - rect.x;
        if (x < 0 || x >= rect.width) continue;
        const i = py * TILE_SIZE + px;
        const k = coverage ? coverage[i]! : ONE;
        for (let c = 0; c < channels; c++)
          out[(y * rect.width + x) * channels + c] = (tile[i * channels + c]! * k) >>> 15;
      }
    }
  });
  return out;
}

/** Removes the source rectangle (or its clipped part) from the tiles. */
function lift<T extends Uint16Array>(
  tiles: TileMap<T>,
  rect: Rect,
  clip: MaskMap | null,
  channels: number,
): Map<TileKey, T> {
  const result = new Map(tiles);
  forEachTileInRect(rect, (tx, ty) => {
    const key = tileKey(tx, ty);
    const tile = tiles.get(key);
    if (!tile) return;
    const coverage = clip?.get(key);
    if (clip && !coverage) return;
    const next = tile.slice() as T;
    for (let py = 0; py < TILE_SIZE; py++) {
      const y = ty * TILE_SIZE + py;
      if (y < rect.y || y >= rect.y + rect.height) continue;
      for (let px = 0; px < TILE_SIZE; px++) {
        const x = tx * TILE_SIZE + px;
        if (x < rect.x || x >= rect.x + rect.width) continue;
        const i = py * TILE_SIZE + px;
        const keep = ONE - (coverage ? coverage[i]! : ONE);
        for (let c = 0; c < channels; c++) next[i * channels + c] = (next[i * channels + c]! * keep) >>> 15;
      }
    }
    if (isEmptyTile(next)) result.delete(key);
    else result.set(key, next);
  });
  return result;
}

/** Bilinear sample of premultiplied values; outside the buffer is transparent. */
function sample(
  src: Uint16Array,
  w: number,
  h: number,
  channels: number,
  u: number,
  v: number,
  out: Float64Array,
): void {
  const x = u - 0.5;
  const y = v - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  out.fill(0, 0, channels);
  for (let dy = 0; dy < 2; dy++) {
    const yy = y0 + dy;
    if (yy < 0 || yy >= h) continue;
    const wy = dy ? fy : 1 - fy;
    for (let dx = 0; dx < 2; dx++) {
      const xx = x0 + dx;
      if (xx < 0 || xx >= w) continue;
      const weight = wy * (dx ? fx : 1 - fx);
      if (weight === 0) continue;
      const p = (yy * w + xx) * channels;
      for (let c = 0; c < channels; c++) out[c]! += src[p + c]! * weight;
    }
  }
}

type Vertex = { sx: number; sy: number; iw: number; u: number; v: number };

/**
 * Rasterizes the mesh in destination space and calls `emit` for every covered pixel center with the
 * perspective-correct source coordinate. Pixel centers on shared edges are emitted once (top-left rule).
 */
function rasterizeMesh(
  mesh: WarpMesh,
  source: Rect,
  clip: Rect,
  emit: (x: number, y: number, u: number, v: number) => void,
): void {
  const vertex = (i: number, j: number): Vertex => {
    const o = (j * (mesh.cols + 1) + i) * 3;
    const w = mesh.points[o + 2]!;
    return {
      sx: mesh.points[o]! / w,
      sy: mesh.points[o + 1]! / w,
      iw: 1 / w,
      u: (i / mesh.cols) * source.width,
      v: (j / mesh.rows) * source.height,
    };
  };
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx);
    if (area === 0) return;
    const sign = area > 0 ? 1 : -1;
    const box = intersectRect(clip, {
      x: Math.floor(Math.min(a.sx, b.sx, c.sx)),
      y: Math.floor(Math.min(a.sy, b.sy, c.sy)),
      width: Math.ceil(Math.max(a.sx, b.sx, c.sx)) - Math.floor(Math.min(a.sx, b.sx, c.sx)) + 1,
      height: Math.ceil(Math.max(a.sy, b.sy, c.sy)) - Math.floor(Math.min(a.sy, b.sy, c.sy)) + 1,
    });
    if (!box) return;
    // Edge functions; `bias` implements the top-left fill rule so shared edges are not drawn twice.
    const edge = (p: Vertex, q: Vertex, x: number, y: number) =>
      ((q.sx - p.sx) * (y - p.sy) - (q.sy - p.sy) * (x - p.sx)) * sign;
    const isTopLeft = (p: Vertex, q: Vertex) => {
      const dy = (q.sy - p.sy) * sign;
      const dx = (q.sx - p.sx) * sign;
      return dy < 0 || (dy === 0 && dx > 0);
    };
    const tlA = isTopLeft(b, c);
    const tlB = isTopLeft(c, a);
    const tlC = isTopLeft(a, b);
    const absArea = Math.abs(area);
    for (let y = box.y; y < box.y + box.height; y++) {
      const cy = y + 0.5;
      for (let x = box.x; x < box.x + box.width; x++) {
        const cx = x + 0.5;
        const wa = edge(b, c, cx, cy);
        const wb = edge(c, a, cx, cy);
        const wc = edge(a, b, cx, cy);
        if (wa < 0 || wb < 0 || wc < 0) continue;
        if ((wa === 0 && !tlA) || (wb === 0 && !tlB) || (wc === 0 && !tlC)) continue;
        const ba = wa / absArea;
        const bb = wb / absArea;
        const bc = wc / absArea;
        const iw = ba * a.iw + bb * b.iw + bc * c.iw;
        const u = (ba * a.u * a.iw + bb * b.u * b.iw + bc * c.u * c.iw) / iw;
        const v = (ba * a.v * a.iw + bb * b.v * b.iw + bc * c.v * c.iw) / iw;
        emit(x, y, u, v);
      }
    }
  };
  for (let j = 0; j < mesh.rows; j++) {
    for (let i = 0; i < mesh.cols; i++) {
      const p00 = vertex(i, j);
      const p10 = vertex(i + 1, j);
      const p01 = vertex(i, j + 1);
      const p11 = vertex(i + 1, j + 1);
      triangle(p00, p10, p11);
      triangle(p00, p11, p01);
    }
  }
}

/**
 * Lifts the clipped source rectangle out of `tiles`, warps it through the mesh and composites it back (source over).
 * `channels` is 4 for premultiplied RGBA layers and 1 for selection masks.
 */
export function warpTiles<T extends Uint16Array>(
  tiles: TileMap<T>,
  source: Rect,
  mesh: WarpMesh,
  clip: MaskMap | null,
  bounds: Rect,
  channels: 1 | 4,
): Map<TileKey, T> {
  const src = extract(tiles, source, clip, channels);
  const result = lift(tiles, source, clip, channels);
  const written = new Map<TileKey, T>();
  const px = new Float64Array(4);
  const tileLength = channels === 4 ? RGBA_TILE_LENGTH : MASK_TILE_LENGTH;
  rasterizeMesh(mesh, source, bounds, (x, y, u, v) => {
    sample(src, source.width, source.height, channels, u, v, px);
    const alpha = px[channels - 1]!;
    if (alpha <= 0) return;
    const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
    let tile = written.get(key);
    if (!tile) {
      tile = (result.get(key)?.slice() ?? new Uint16Array(tileLength)) as T;
      written.set(key, tile);
    }
    const i = ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * channels;
    const keep = 1 - Math.min(alpha / ONE, 1);
    for (let c = 0; c < channels; c++) tile[i + c] = Math.min(Math.round(px[c]! + tile[i + c]! * keep), ONE);
  });
  for (const [key, tile] of written) result.set(key, tile);
  return result;
}
