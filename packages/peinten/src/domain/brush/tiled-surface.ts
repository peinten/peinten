import { FIX15_ONE, isEmptyTile, RGBA_TILE_LENGTH, TILE_SIZE, type TileKey, tileKey } from '../tiles/tile.ts';
import type { MaskMap, Rect, TileMap } from '../tiles/tile-map.ts';
import type { ColorMixer } from './color-mixer.ts';
import { type MaskBounds, renderDabMask } from './dab-mask.ts';
import {
  blendColor,
  blendLockAlpha,
  blendLockAlphaPaint,
  blendNormal,
  blendNormalAndEraser,
  blendNormalAndEraserPaint,
  blendNormalPaint,
  blendPosterize,
} from './pixel-blend.ts';
import type { DabParams, Surface } from './surface.ts';

const maskBuffer = new Uint16Array(TILE_SIZE * TILE_SIZE);
const maskBounds: MaskBounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
const ZERO_RGBA = new Uint16Array(RGBA_TILE_LENGTH);
const latentAverage = new Float32Array(64);
const latentSample = new Float32Array(64);
const rgbScratch = new Float32Array(3);

export interface TiledSurfaceOptions {
  readonly mixer: ColorMixer;
  /** Document bounds; tiles entirely outside are never written. */
  readonly bounds: Rect;
  /** Selection coverage that limits painting, or null to paint everywhere. */
  readonly clip: MaskMap | null;
  /** Layer alpha lock: every dab keeps the existing alpha. */
  readonly alphaLocked: boolean;
}

/**
 * Brush surface over copy-on-write fix15 RGBA tiles. Port of libmypaint's MyPaintTiledSurface.
 * Committed tiles are never touched: the first write to a tile copies it into the working set.
 */
export class TiledSurface implements Surface {
  readonly #base: TileMap;
  readonly #options: TiledSurfaceOptions;
  readonly #work = new Map<TileKey, Uint16Array>();
  #dirty = new Set<TileKey>();
  readonly #txMax: number;
  readonly #tyMax: number;

  constructor(base: TileMap, options: TiledSurfaceOptions) {
    this.#base = base;
    this.#options = options;
    this.#txMax = Math.floor((options.bounds.x + options.bounds.width - 1) / TILE_SIZE);
    this.#tyMax = Math.floor((options.bounds.y + options.bounds.height - 1) / TILE_SIZE);
  }

  #inBounds(tx: number, ty: number): boolean {
    return (
      tx >= Math.floor(this.#options.bounds.x / TILE_SIZE) &&
      ty >= Math.floor(this.#options.bounds.y / TILE_SIZE) &&
      tx <= this.#txMax &&
      ty <= this.#tyMax
    );
  }

  /** Tile to read from: the working copy if any, else the committed tile. */
  readTile(key: TileKey): Uint16Array | undefined {
    return this.#work.get(key) ?? this.#base.get(key);
  }

  #writeTile(key: TileKey): Uint16Array {
    let tile = this.#work.get(key);
    if (!tile) {
      const committed = this.#base.get(key);
      tile = committed ? committed.slice() : new Uint16Array(RGBA_TILE_LENGTH);
      this.#work.set(key, tile);
    }
    this.#dirty.add(key);
    return tile;
  }

  /** Applies the selection coverage to the dab mask. Returns false when nothing of the dab is selected. */
  #clipMask(key: TileKey, b: MaskBounds): boolean {
    const clip = this.#options.clip;
    if (!clip) return true;
    const coverage = clip.get(key);
    if (!coverage) return false;
    let any = false;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const i = y * TILE_SIZE + x;
        const value = (maskBuffer[i]! * coverage[i]!) >>> 15;
        maskBuffer[i] = value;
        if (value) any = true;
      }
    }
    return any;
  }

  drawDab(dab: Readonly<DabParams>): boolean {
    const opaque = Math.min(Math.max(dab.opaque, 0), 1);
    const hardness = Math.min(Math.max(dab.hardness, 0), 1);
    const softness = Math.min(Math.max(dab.softness, 0), 1);
    const lockAlpha = this.#options.alphaLocked ? 1 : Math.min(Math.max(dab.lockAlpha, 0), 1);
    const colorize = Math.min(Math.max(dab.colorize, 0), 1);
    const posterize = Math.min(Math.max(dab.posterize, 0), 1);
    const posterizeNum = Math.min(Math.max(Math.trunc(dab.posterizeNum * 100 + 0.5), 1), 128);
    const paint = Math.min(Math.max(dab.paint, 0), 1);
    if (dab.radius < 0.1 || hardness === 0 || softness === 1 || opaque === 0) return false;

    const cr = Math.trunc(Math.min(Math.max(dab.colorR, 0), 1) * FIX15_ONE);
    const cg = Math.trunc(Math.min(Math.max(dab.colorG, 0), 1) * FIX15_ONE);
    const cb = Math.trunc(Math.min(Math.max(dab.colorB, 0), 1) * FIX15_ONE);
    const colorA = Math.min(Math.max(dab.colorA, 0), 1);
    const normal = (1 - lockAlpha) * (1 - colorize) * (1 - posterize);
    const aspect = dab.aspectRatio < 1 ? 1 : dab.aspectRatio;
    const mixer = this.#options.mixer;

    const rFringe = dab.radius + 1;
    const tx1 = Math.floor(Math.floor(dab.x - rFringe) / TILE_SIZE);
    const tx2 = Math.floor(Math.floor(dab.x + rFringe) / TILE_SIZE);
    const ty1 = Math.floor(Math.floor(dab.y - rFringe) / TILE_SIZE);
    const ty2 = Math.floor(Math.floor(dab.y + rFringe) / TILE_SIZE);

    for (let ty = ty1; ty <= ty2; ty++) {
      for (let tx = tx1; tx <= tx2; tx++) {
        if (!this.#inBounds(tx, ty)) continue;
        const key = tileKey(tx, ty);
        const b = renderDabMask(
          maskBuffer,
          dab.x - tx * TILE_SIZE,
          dab.y - ty * TILE_SIZE,
          dab.radius,
          hardness,
          softness,
          aspect,
          dab.angle,
          maskBounds,
        );
        if (!b || !this.#clipMask(key, b)) continue;
        const rgba = this.#writeTile(key);

        // Port of libmypaint's process_op: stamp the mask once per active blend mode.
        if (paint < 1) {
          if (normal) {
            const opacity = Math.trunc(normal * opaque * (1 - paint) * FIX15_ONE);
            if (colorA === 1) blendNormal(maskBuffer, b, rgba, cr, cg, cb, opacity);
            else blendNormalAndEraser(maskBuffer, b, rgba, cr, cg, cb, Math.trunc(colorA * FIX15_ONE), opacity);
          }
          if (lockAlpha && colorA !== 0) {
            const opacity = Math.trunc(lockAlpha * opaque * (1 - colorize) * (1 - posterize) * (1 - paint) * FIX15_ONE);
            blendLockAlpha(maskBuffer, b, rgba, cr, cg, cb, opacity);
          }
        }
        if (paint > 0) {
          if (normal) {
            const opacity = Math.trunc(normal * opaque * paint * FIX15_ONE);
            if (colorA === 1) blendNormalPaint(mixer, maskBuffer, b, rgba, cr, cg, cb, opacity);
            else
              blendNormalAndEraserPaint(
                mixer,
                maskBuffer,
                b,
                rgba,
                cr,
                cg,
                cb,
                Math.trunc(colorA * FIX15_ONE),
                opacity,
              );
          }
          if (lockAlpha && colorA !== 0) {
            const opacity = Math.trunc(lockAlpha * opaque * (1 - colorize) * (1 - posterize) * paint * FIX15_ONE);
            blendLockAlphaPaint(mixer, maskBuffer, b, rgba, cr, cg, cb, opacity);
          }
        }
        if (colorize) blendColor(maskBuffer, b, rgba, cr, cg, cb, Math.trunc(colorize * opaque * FIX15_ONE));
        if (posterize) blendPosterize(maskBuffer, b, rgba, Math.trunc(posterize * opaque * FIX15_ONE), posterizeNum);
      }
    }
    return true;
  }

  getColor(x: number, y: number, radiusIn: number, out: Float64Array, paint: number): void {
    const radius = radiusIn < 1 ? 1 : radiusIn;
    const mixer = this.#options.mixer;
    const n = mixer.latentSize;
    let sumWeight = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    const rFringe = radius + 1;
    const tx1 = Math.floor(Math.floor(x - rFringe) / TILE_SIZE);
    const tx2 = Math.floor(Math.floor(x + rFringe) / TILE_SIZE);
    const ty1 = Math.floor(Math.floor(y - rFringe) / TILE_SIZE);
    const ty2 = Math.floor(Math.floor(y + rFringe) / TILE_SIZE);
    const sampleInterval = radius <= 2 ? 1 : Math.trunc(radius * 7);
    // libmypaint samples a random subset with C rand(); a position-seeded LCG keeps peers in agreement.
    const randomThreshold = Math.trunc((1 / (7 * radius)) * 0x7fffffff);
    let lcg = (Math.imul(Math.floor(x), 73856093) ^ Math.imul(Math.floor(y), 19349663)) >>> 0;

    for (let ty = ty1; ty <= ty2; ty++) {
      for (let tx = tx1; tx <= tx2; tx++) {
        const key = tileKey(tx, ty);
        const rgba = (this.#inBounds(tx, ty) && this.readTile(key)) || ZERO_RGBA;
        const b = renderDabMask(maskBuffer, x - tx * TILE_SIZE, y - ty * TILE_SIZE, radius, 0.5, 0.5, 1, 0, maskBounds);
        if (!b) continue;

        if (paint < 0) {
          // get_color_pixels_legacy: integer sums per tile.
          let weight = 0;
          let r = 0;
          let g = 0;
          let bl = 0;
          let a = 0;
          for (let yy = b.y0; yy <= b.y1; yy++) {
            for (let xx = b.x0; xx <= b.x1; xx++) {
              const i = yy * TILE_SIZE + xx;
              const opa = maskBuffer[i]!;
              if (!opa) continue;
              const p = i * 4;
              weight += opa;
              r += (opa * rgba[p]!) >>> 15;
              g += (opa * rgba[p + 1]!) >>> 15;
              bl += (opa * rgba[p + 2]!) >>> 15;
              a += (opa * rgba[p + 3]!) >>> 15;
            }
          }
          sumWeight += weight;
          sumR += r;
          sumG += g;
          sumB += bl;
          sumA += a;
          continue;
        }

        // get_color_pixels_accumulate: running additive and spectral averages.
        let avgR = sumR;
        let avgG = sumG;
        let avgB = sumB;
        if (paint > 0) mixer.toLatent(sumR, sumG, sumB, latentAverage, 0);
        let counter = 0;
        for (let yy = b.y0; yy <= b.y1; yy++) {
          for (let xx = b.x0; xx <= b.x1; xx++) {
            const i = yy * TILE_SIZE + xx;
            const m = maskBuffer[i]!;
            if (!m) continue;
            lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0;
            if (counter === 0 || lcg >>> 1 < randomThreshold) {
              const p = i * 4;
              const alpha = rgba[p + 3]!;
              const a = (m * alpha) / 2 ** 30;
              const alphaSums = a + sumA;
              sumWeight += m / FIX15_ONE;
              let facA = 1;
              let facB = 1;
              if (alphaSums > 0) {
                facA = a / alphaSums;
                facB = 1 - facA;
              }
              if (paint > 0 && alpha > 0) {
                mixer.toLatent(rgba[p]! / alpha, rgba[p + 1]! / alpha, rgba[p + 2]! / alpha, latentSample, 0);
                for (let k = 0; k < n; k++) latentAverage[k] = latentSample[k]! * facA + latentAverage[k]! * facB;
              }
              if (paint < 1 && alpha > 0) {
                avgR = (rgba[p]! * facA) / alpha + avgR * facB;
                avgG = (rgba[p + 1]! * facA) / alpha + avgG * facB;
                avgB = (rgba[p + 2]! * facA) / alpha + avgB * facB;
              }
              sumA += a;
            }
            counter = (counter + 1) % sampleInterval;
          }
        }
        let specR = 0;
        let specG = 0;
        let specB = 0;
        if (paint > 0) {
          mixer.fromLatent(latentAverage, 0, rgbScratch);
          specR = rgbScratch[0]!;
          specG = rgbScratch[1]!;
          specB = rgbScratch[2]!;
        }
        sumR = specR * paint + (1 - paint) * avgR;
        sumG = specG * paint + (1 - paint) * avgG;
        sumB = specB * paint + (1 - paint) * avgB;
      }
    }

    if (sumWeight <= 0) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      out[3] = 0;
      return;
    }
    sumA /= sumWeight;
    if (paint < 0) {
      sumR /= sumWeight;
      sumG /= sumWeight;
      sumB /= sumWeight;
    }
    out[3] = Math.min(Math.max(sumA, 0), 1);
    if (sumA > 0) {
      const demul = paint < 0 ? sumA : 1;
      out[0] = Math.min(Math.max(sumR / demul, 0), 1);
      out[1] = Math.min(Math.max(sumG / demul, 0), 1);
      out[2] = Math.min(Math.max(sumB / demul, 0), 1);
    } else {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
    }
  }

  /** Keys of tiles written since the previous call. Used to upload only changed tiles to the GPU. */
  takeDirty(): TileKey[] {
    const keys = [...this.#dirty];
    this.#dirty = new Set();
    return keys;
  }

  /** Working tiles that shadow committed tiles while the stroke is live. */
  get workingTiles(): ReadonlyMap<TileKey, Uint16Array> {
    return this.#work;
  }

  /**
   * Freezes the working tiles into a new committed tile map. Empty tiles are dropped.
   * The surface must not be drawn on afterwards.
   */
  commit(): TileMap {
    if (this.#work.size === 0) return this.#base;
    const result = new Map(this.#base);
    for (const [key, tile] of this.#work) {
      if (isEmptyTile(tile)) result.delete(key);
      else result.set(key, tile);
    }
    return result;
  }
}
