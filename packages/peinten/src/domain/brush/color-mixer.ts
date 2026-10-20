/**
 * Pigment-style color mixing expressed as linear interpolation in a latent space.
 * libmypaint's spectral weighted geometric mean (log reflectance) and Mixbox both fit this shape.
 */
export interface ColorMixer {
  /** Part of the collaboration registry hash; peers must use the same mixer. */
  readonly id: string;
  readonly latentSize: number;
  /** Converts straight RGB in 0..1 into `latentSize` floats written at `offset`. */
  toLatent(r: number, g: number, b: number, out: Float32Array, offset: number): void;
  /** Converts a latent vector back to straight RGB in 0..1, written to `out[0..2]`. */
  fromLatent(latent: Float32Array, offset: number, out: Float32Array): void;
}

// Shared views for float32 bit tricks used by the fast log/pow approximations.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Port of fastapprox's fastlog2, the approximation libmypaint uses for pigment blending. */
function fastLog2(x: number): number {
  f32[0] = x;
  const bits = u32[0]!;
  u32[0] = (bits & 0x007fffff) | 0x3f000000;
  const mx = f32[0]!;
  return bits * 1.1920928955078125e-7 - 124.22551499 - 1.498030302 * mx - 1.72587999 / (0.3520887068 + mx);
}

/** Port of fastapprox's fastpow2. */
function fastPow2(p: number): number {
  const offset = p < 0 ? 1 : 0;
  const clipp = p < -126 ? -126 : p;
  const z = clipp - Math.trunc(clipp) + offset;
  u32[0] = (1 << 23) * (clipp + 121.2740575 + 27.7280233 / (4.84252568 - z) - 1.49012907 * z);
  return f32[0]!;
}

const WGM_EPSILON = 0.001;
const OFFSET = 1 - WGM_EPSILON;

// Spectral primaries and the spectral-to-RGB matrix from libmypaint helpers.c.
const SPECTRAL_R = [
  0.009281362787953, 0.009732627042016, 0.011254252737167, 0.015105578649573, 0.024797924177217, 0.083622585502406,
  0.977865045723212, 1.0, 0.999961046144372, 0.999999992756822,
];
const SPECTRAL_G = [
  0.002854127435775, 0.003917589679914, 0.012132151699187, 0.748259205918013, 1.0, 0.865695937531795, 0.037477469241101,
  0.022816789725717, 0.021747419446456, 0.021384940572308,
];
const SPECTRAL_B = [
  0.537052150373386, 0.546646402401469, 0.575501819073983, 0.258778829633924, 0.041709923751716, 0.012662638828324,
  0.00748559312739, 0.006766900622462, 0.006699764779016, 0.006676219883241,
];
const T_MATRIX = [
  [
    0.026595621243689, 0.049779426257903, 0.022449850859496, -0.218453689278271, -0.256894883201278, 0.44588172219484,
    0.772365886289756, 0.194498761382537, 0.01403815758782, 0.007687264480513,
  ],
  [
    -0.032601672674412, -0.061021043498478, -0.052490001018404, 0.206659098273522, 0.572496335158169, 0.317837248815438,
    -0.021216624031211, -0.019387668756117, -0.001521339050858, -0.000835181622534,
  ],
  [
    0.339475473216284, 0.635401374177222, 0.771520797089589, 0.113222640692379, -0.055251113343776, -0.04822257846868,
    -0.012966666339586, -0.001523814504223, -0.00009471894881, -0.000051604594741,
  ],
];

/**
 * libmypaint 2.0's pigment mode: RGB is upsampled to 10 spectral bands and mixed with a weighted geometric mean.
 * The latent space is log2 of the spectral reflectance, where the geometric mean becomes linear interpolation.
 */
export const libMyPaintPigmentMixer: ColorMixer = {
  id: 'libmypaint-pigment',
  latentSize: 10,
  toLatent(r, g, b, out, offset) {
    const rr = r * OFFSET + WGM_EPSILON;
    const gg = g * OFFSET + WGM_EPSILON;
    const bb = b * OFFSET + WGM_EPSILON;
    for (let i = 0; i < 10; i++) {
      out[offset + i] = fastLog2(SPECTRAL_R[i]! * rr + SPECTRAL_G[i]! * gg + SPECTRAL_B[i]! * bb);
    }
  },
  fromLatent(latent, offset, out) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 10; i++) {
      const spectral = fastPow2(latent[offset + i]!);
      r += T_MATRIX[0]![i]! * spectral;
      g += T_MATRIX[1]![i]! * spectral;
      b += T_MATRIX[2]![i]! * spectral;
    }
    out[0] = Math.min(Math.max((r - WGM_EPSILON) / OFFSET, 0), 1);
    out[1] = Math.min(Math.max((g - WGM_EPSILON) / OFFSET, 0), 1);
    out[2] = Math.min(Math.max((b - WGM_EPSILON) / OFFSET, 0), 1);
  },
};

/** Scratch buffers for `mixColors`; brush code is single-threaded per worker. */
const latentA = new Float32Array(64);
const latentB = new Float32Array(64);
const mixedRgb = new Float32Array(3);

/**
 * Port of libmypaint's `mix_colors`: blends straight RGBA colors `a` and `b`, weighting `a` by `fac`.
 * The result is the additive mix and the pigment mix interpolated by `paintMode`.
 */
export function mixColors(
  mixer: ColorMixer,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  fac: number,
  paintMode: number,
  out: Float64Array,
): Float64Array {
  const opaA = fac;
  const opaB = 1 - opaA;
  out[3] = Math.min(Math.max(opaA * a[3]! + opaB * b[3]!, 0), 1);
  const sfacA = a[3] === 0 ? 0 : (opaA * a[3]!) / (a[3]! + b[3]! * opaB);
  const sfacB = 1 - sfacA;
  if (paintMode > 0) {
    const n = mixer.latentSize;
    mixer.toLatent(a[0]!, a[1]!, a[2]!, latentA, 0);
    mixer.toLatent(b[0]!, b[1]!, b[2]!, latentB, 0);
    for (let i = 0; i < n; i++) latentA[i] = latentA[i]! * sfacA + latentB[i]! * sfacB;
    mixer.fromLatent(latentA, 0, mixedRgb);
    out[0] = mixedRgb[0]!;
    out[1] = mixedRgb[1]!;
    out[2] = mixedRgb[2]!;
  }
  if (paintMode < 1) {
    for (let i = 0; i < 3; i++) out[i] = out[i]! * paintMode + (1 - paintMode) * (a[i]! * opaA + b[i]! * opaB);
  }
  return out;
}
