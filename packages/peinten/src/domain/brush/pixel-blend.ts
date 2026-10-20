// Ports of libmypaint's brushmodes.c. Pixels are premultiplied fix15 RGBA; the mask is fix15 coverage.
// Integer divisions by 2^15 are `>>> 15` because every product here stays below 2^32.
import { FIX15_ONE, TILE_SIZE } from '../tiles/tile.ts';
import type { ColorMixer } from './color-mixer.ts';
import type { MaskBounds } from './dab-mask.ts';

export function blendNormal(
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  opacity: number,
): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      const opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      rgba[p + 3] = opaA + ((opaB * rgba[p + 3]!) >>> 15);
      rgba[p] = (opaA * cr + opaB * rgba[p]!) >>> 15;
      rgba[p + 1] = (opaA * cg + opaB * rgba[p + 1]!) >>> 15;
      rgba[p + 2] = (opaA * cb + opaB * rgba[p + 2]!) >>> 15;
    }
  }
}

/** Normal blending towards a target alpha; used for erasing and smudging transparency. */
export function blendNormalAndEraser(
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  ca: number,
  opacity: number,
): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      let opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      opaA = (opaA * ca) >>> 15;
      rgba[p + 3] = opaA + ((opaB * rgba[p + 3]!) >>> 15);
      rgba[p] = (opaA * cr + opaB * rgba[p]!) >>> 15;
      rgba[p + 1] = (opaA * cg + opaB * rgba[p + 1]!) >>> 15;
      rgba[p + 2] = (opaA * cb + opaB * rgba[p + 2]!) >>> 15;
    }
  }
}

/** Normal blending that keeps the alpha channel. */
export function blendLockAlpha(
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  opacity: number,
): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      let opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      opaA = (opaA * rgba[p + 3]!) >>> 15;
      rgba[p] = (opaA * cr + opaB * rgba[p]!) >>> 15;
      rgba[p + 1] = (opaA * cg + opaB * rgba[p + 1]!) >>> 15;
      rgba[p + 2] = (opaA * cb + opaB * rgba[p + 2]!) >>> 15;
    }
  }
}

export function blendPosterize(
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  opacity: number,
  levels: number,
): void {
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      const postR = Math.trunc((FIX15_ONE * Math.trunc((rgba[p]! / FIX15_ONE) * levels + 0.5)) / levels);
      const postG = Math.trunc((FIX15_ONE * Math.trunc((rgba[p + 1]! / FIX15_ONE) * levels + 0.5)) / levels);
      const postB = Math.trunc((FIX15_ONE * Math.trunc((rgba[p + 2]! / FIX15_ONE) * levels + 0.5)) / levels);
      const opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      rgba[p] = (opaA * postR + opaB * rgba[p]!) >>> 15;
      rgba[p + 1] = (opaA * postG + opaB * rgba[p + 1]!) >>> 15;
      rgba[p + 2] = (opaA * postB + opaB * rgba[p + 2]!) >>> 15;
    }
  }
}

const LUMA_R = 0.2126 * FIX15_ONE;
const LUMA_G = 0.7152 * FIX15_ONE;
const LUMA_B = 0.0722 * FIX15_ONE;
const luma = (r: number, g: number, b: number) => r * LUMA_R + g * LUMA_G + b * LUMA_B;

/** Colorize: applies the dab's hue and saturation, keeping the canvas luminosity and alpha. */
export function blendColor(
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  opacity: number,
): void {
  const topLum = Math.trunc(luma(cr, cg, cb) / FIX15_ONE) & 0xffff;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      const a = rgba[p + 3]!;
      let r = 0;
      let g = 0;
      let bl = 0;
      if (a !== 0) {
        r = Math.trunc((FIX15_ONE * rgba[p]!) / a) & 0xffff;
        g = Math.trunc((FIX15_ONE * rgba[p + 1]!) / a) & 0xffff;
        bl = Math.trunc((FIX15_ONE * rgba[p + 2]!) / a) & 0xffff;
      }
      // set_rgb16_lum_from_rgb16: take the dab color, shifted to the canvas luminosity.
      const botLum = Math.trunc(luma(r, g, bl) / FIX15_ONE) & 0xffff;
      const diff = ((botLum - topLum) << 16) >> 16;
      let nr = cr + diff;
      let ng = cg + diff;
      let nb = cb + diff;
      const lum = Math.trunc(luma(nr, ng, nb) / FIX15_ONE);
      const cmin = Math.min(nr, ng, nb);
      const cmax = Math.max(nr, ng, nb);
      if (cmin < 0) {
        nr = lum + Math.trunc(((nr - lum) * lum) / (lum - cmin));
        ng = lum + Math.trunc(((ng - lum) * lum) / (lum - cmin));
        nb = lum + Math.trunc(((nb - lum) * lum) / (lum - cmin));
      }
      if (cmax > FIX15_ONE) {
        nr = lum + Math.trunc(((nr - lum) * (FIX15_ONE - lum)) / (cmax - lum));
        ng = lum + Math.trunc(((ng - lum) * (FIX15_ONE - lum)) / (cmax - lum));
        nb = lum + Math.trunc(((nb - lum) * (FIX15_ONE - lum)) / (cmax - lum));
      }
      r = ((nr & 0xffff) * a) >>> 15;
      g = ((ng & 0xffff) * a) >>> 15;
      bl = ((nb & 0xffff) * a) >>> 15;
      const opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      rgba[p] = (opaA * r + opaB * rgba[p]!) >>> 15;
      rgba[p + 1] = (opaA * g + opaB * rgba[p + 1]!) >>> 15;
      rgba[p + 2] = (opaA * bl + opaB * rgba[p + 2]!) >>> 15;
    }
  }
}

const latentTop = new Float32Array(64);
const latentBottom = new Float32Array(64);
const mixed = new Float32Array(3);

/** Straightens the pixel at `p` and mixes it with the dab color in the mixer's latent space. */
function mixPixel(mixer: ColorMixer, rgba: Uint16Array, p: number, facA: number): Float32Array {
  const a = rgba[p + 3]!;
  const n = mixer.latentSize;
  mixer.toLatent(rgba[p]! / a, rgba[p + 1]! / a, rgba[p + 2]! / a, latentBottom, 0);
  const facB = 1 - facA;
  for (let k = 0; k < n; k++) latentBottom[k] = latentTop[k]! * facA + latentBottom[k]! * facB;
  mixer.fromLatent(latentBottom, 0, mixed);
  return mixed;
}

/** Pigment-mode counterpart of `blendNormal`. */
export function blendNormalPaint(
  mixer: ColorMixer,
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  opacityIn: number,
): void {
  mixer.toLatent(cr / FIX15_ONE, cg / FIX15_ONE, cb / FIX15_ONE, latentTop, 0);
  // Pigment mode does not like very low opacity because of int/float round trips; libmypaint enforces a minimum.
  const opacity = Math.max(opacityIn, 150);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      const opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      if (rgba[p + 3]! <= 0) {
        rgba[p + 3] = opaA + ((opaB * rgba[p + 3]!) >>> 15);
        rgba[p] = (opaA * cr + opaB * rgba[p]!) >>> 15;
        rgba[p + 1] = (opaA * cg + opaB * rgba[p + 1]!) >>> 15;
        rgba[p + 2] = (opaA * cb + opaB * rgba[p + 2]!) >>> 15;
        continue;
      }
      const facA = opaA / (opaA + ((opaB * rgba[p + 3]!) >>> 15));
      const rgb = mixPixel(mixer, rgba, p, facA);
      const alpha = opaA + ((opaB * rgba[p + 3]!) >>> 15);
      rgba[p + 3] = alpha;
      rgba[p] = Math.trunc(rgb[0]! * alpha + 0.5);
      rgba[p + 1] = Math.trunc(rgb[1]! * alpha + 0.5);
      rgba[p + 2] = Math.trunc(rgb[2]! * alpha + 0.5);
    }
  }
}

/** Fast sigmoid used to fade from additive to spectral blending as canvas alpha grows. */
function spectralBlendFactor(x: number): number {
  const bb = x * 8 - 3;
  return 0.5 + bb / (1 + Math.abs(bb) * 1.65);
}

/** Pigment-mode counterpart of `blendNormalAndEraser`. */
export function blendNormalAndEraserPaint(
  mixer: ColorMixer,
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  ca: number,
  opacity: number,
): void {
  mixer.toLatent(cr / FIX15_ONE, cg / FIX15_ONE, cb / FIX15_ONE, latentTop, 0);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      const opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      const opaA2 = (opaA * ca) >>> 15;
      const alpha = rgba[p + 3]!;
      const opaOut = opaA2 + ((opaB * alpha) >>> 15);
      const spectralFactor = Math.min(Math.max(spectralBlendFactor(alpha / FIX15_ONE), 0), 1);
      const additiveFactor = 1 - spectralFactor;
      let r = 0;
      let g = 0;
      let bl = 0;
      if (additiveFactor) {
        r = (opaA2 * cr + opaB * rgba[p]!) >>> 15;
        g = (opaA2 * cg + opaB * rgba[p + 1]!) >>> 15;
        bl = (opaA2 * cb + opaB * rgba[p + 2]!) >>> 15;
      }
      if (spectralFactor && alpha !== 0) {
        const facA = (opaA / (opaA + ((opaB * alpha) >>> 15))) * (ca / FIX15_ONE);
        const rgb = mixPixel(mixer, rgba, p, facA);
        r = Math.trunc(additiveFactor * r + spectralFactor * rgb[0]! * opaOut);
        g = Math.trunc(additiveFactor * g + spectralFactor * rgb[1]! * opaOut);
        bl = Math.trunc(additiveFactor * bl + spectralFactor * rgb[2]! * opaOut);
      }
      rgba[p + 3] = opaOut;
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = bl;
    }
  }
}

/** Pigment-mode counterpart of `blendLockAlpha`. */
export function blendLockAlphaPaint(
  mixer: ColorMixer,
  mask: Uint16Array,
  b: MaskBounds,
  rgba: Uint16Array,
  cr: number,
  cg: number,
  cb: number,
  opacityIn: number,
): void {
  mixer.toLatent(cr / FIX15_ONE, cg / FIX15_ONE, cb / FIX15_ONE, latentTop, 0);
  const opacity = Math.max(opacityIn, 150);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * TILE_SIZE + x;
      const m = mask[i]!;
      if (!m) continue;
      const p = i * 4;
      let opaA = (m * opacity) >>> 15;
      const opaB = FIX15_ONE - opaA;
      opaA = (opaA * rgba[p + 3]!) >>> 15;
      if (rgba[p + 3]! <= 0) {
        rgba[p] = (opaA * cr + opaB * rgba[p]!) >>> 15;
        rgba[p + 1] = (opaA * cg + opaB * rgba[p + 1]!) >>> 15;
        rgba[p + 2] = (opaA * cb + opaB * rgba[p + 2]!) >>> 15;
        continue;
      }
      const facA = opaA / (opaA + ((opaB * rgba[p + 3]!) >>> 15));
      const rgb = mixPixel(mixer, rgba, p, facA);
      const alpha = rgba[p + 3]!;
      rgba[p] = Math.trunc(rgb[0]! * alpha + 0.5);
      rgba[p + 1] = Math.trunc(rgb[1]! * alpha + 0.5);
      rgba[p + 2] = Math.trunc(rgb[2]! * alpha + 0.5);
    }
  }
}
