import { FIX15_ONE, isUniformTile, MASK_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import type { MaskMap, Rect } from '../tiles/tile-map.ts';
import { type MaskBounds, renderDabMask } from './dab-mask.ts';
import type { DabParams, Surface } from './surface.ts';

const maskBuffer = new Uint16Array(TILE_SIZE * TILE_SIZE);
const maskBounds: MaskBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };

export interface MaskSurfaceOptions {
  /** fix15 value of pixels without a tile; 0 for selections. */
  readonly fill?: number;
  /**
   * Paint the dab color's lightness instead of full coverage, as layer masks do: white shows, black hides, and the
   * eraser hides. Without it, painting covers and erasing uncovers, as quick mask does.
   */
  readonly lightness?: boolean;
  /** Coverage that limits where dabs land, such as the painter's selection. */
  readonly clip?: MaskMap | null;
}

/**
 * Brush surface over single-channel coverage: the selection in quick mask, or a layer mask.
 * Dabs blend coverage towards the dab's target, which is set by `MaskSurfaceOptions.lightness`.
 */
export class MaskSurface implements Surface {
  readonly #base: MaskMap;
  readonly #bounds: Rect;
  readonly #fill: number;
  readonly #lightness: boolean;
  readonly #clip: MaskMap | null;
  readonly #work = new Map<TileKey, Uint16Array>();
  #dirty = new Set<TileKey>();

  constructor(base: MaskMap, bounds: Rect, options: MaskSurfaceOptions = {}) {
    this.#base = base;
    this.#bounds = bounds;
    this.#fill = options.fill ?? 0;
    this.#lightness = options.lightness ?? false;
    this.#clip = options.clip ?? null;
  }

  #inBounds(tx: number, ty: number): boolean {
    const b = this.#bounds;
    return (
      tx >= Math.floor(b.x / TILE_SIZE) &&
      ty >= Math.floor(b.y / TILE_SIZE) &&
      tx <= Math.floor((b.x + b.width - 1) / TILE_SIZE) &&
      ty <= Math.floor((b.y + b.height - 1) / TILE_SIZE)
    );
  }

  readTile(key: TileKey): Uint16Array | undefined {
    return this.#work.get(key) ?? this.#base.get(key);
  }

  drawDab(dab: Readonly<DabParams>): boolean {
    const opaque = Math.min(Math.max(dab.opaque, 0), 1);
    const hardness = Math.min(Math.max(dab.hardness, 0), 1);
    const softness = Math.min(Math.max(dab.softness, 0), 1);
    if (dab.radius < 0.1 || hardness === 0 || softness === 1 || opaque === 0) return false;
    const alpha = Math.min(Math.max(dab.colorA, 0), 1);
    // Rec. 709 luma of the straight dab color; the eraser's zero alpha makes it hide.
    const lightness = 0.2126 * dab.colorR + 0.7152 * dab.colorG + 0.0722 * dab.colorB;
    const target = Math.trunc((this.#lightness ? Math.min(Math.max(lightness, 0), 1) * alpha : alpha) * FIX15_ONE);
    const opacity = Math.trunc(opaque * FIX15_ONE);
    const rFringe = dab.radius + 1;
    const tx1 = Math.floor(Math.floor(dab.x - rFringe) / TILE_SIZE);
    const tx2 = Math.floor(Math.floor(dab.x + rFringe) / TILE_SIZE);
    const ty1 = Math.floor(Math.floor(dab.y - rFringe) / TILE_SIZE);
    const ty2 = Math.floor(Math.floor(dab.y + rFringe) / TILE_SIZE);
    for (let ty = ty1; ty <= ty2; ty++) {
      for (let tx = tx1; tx <= tx2; tx++) {
        if (!this.#inBounds(tx, ty)) continue;
        const b = renderDabMask(
          maskBuffer,
          dab.x - tx * TILE_SIZE,
          dab.y - ty * TILE_SIZE,
          dab.radius,
          hardness,
          softness,
          dab.aspectRatio,
          dab.angle,
          maskBounds,
        );
        if (!b) continue;
        const key = tileKey(tx, ty);
        const clip = this.#clip?.get(key);
        if (this.#clip && !clip) continue;
        let tile = this.#work.get(key);
        if (!tile) {
          tile = this.#base.get(key)?.slice() ?? new Uint16Array(MASK_TILE_LENGTH).fill(this.#fill);
          this.#work.set(key, tile);
        }
        this.#dirty.add(key);
        for (let y = b.y0; y <= b.y1; y++) {
          for (let x = b.x0; x <= b.x1; x++) {
            const i = y * TILE_SIZE + x;
            const m = clip ? (maskBuffer[i]! * clip[i]!) >>> 15 : maskBuffer[i]!;
            if (!m) continue;
            const opaA = (m * opacity) >>> 15;
            tile[i] = (opaA * target + (FIX15_ONE - opaA) * tile[i]!) >>> 15;
          }
        }
      }
    }
    return true;
  }

  /** Reports the average coverage as a gray, fully opaque color. */
  getColor(x: number, y: number, radiusIn: number, out: Float64Array): void {
    const radius = radiusIn < 1 ? 1 : radiusIn;
    let weight = 0;
    let sum = 0;
    const rFringe = radius + 1;
    for (
      let ty = Math.floor(Math.floor(y - rFringe) / TILE_SIZE);
      ty <= Math.floor(Math.floor(y + rFringe) / TILE_SIZE);
      ty++
    ) {
      for (
        let tx = Math.floor(Math.floor(x - rFringe) / TILE_SIZE);
        tx <= Math.floor(Math.floor(x + rFringe) / TILE_SIZE);
        tx++
      ) {
        const b = renderDabMask(maskBuffer, x - tx * TILE_SIZE, y - ty * TILE_SIZE, radius, 0.5, 0.5, 1, 0, maskBounds);
        if (!b) continue;
        const tile = this.readTile(tileKey(tx, ty));
        for (let yy = b.y0; yy <= b.y1; yy++) {
          for (let xx = b.x0; xx <= b.x1; xx++) {
            const i = yy * TILE_SIZE + xx;
            const m = maskBuffer[i]!;
            weight += m;
            sum += m * (tile?.[i] ?? this.#fill);
          }
        }
      }
    }
    const value = weight > 0 ? sum / weight / FIX15_ONE : 0;
    out[0] = out[1] = out[2] = value;
    out[3] = 1;
  }

  takeDirty(): TileKey[] {
    const keys = [...this.#dirty];
    this.#dirty = new Set();
    return keys;
  }

  get workingTiles(): ReadonlyMap<TileKey, Uint16Array> {
    return this.#work;
  }

  commit(): MaskMap {
    if (this.#work.size === 0) return this.#base;
    const result = new Map(this.#base);
    for (const [key, tile] of this.#work) {
      if (isUniformTile(tile, this.#fill)) result.delete(key);
      else result.set(key, tile);
    }
    return result;
  }
}
