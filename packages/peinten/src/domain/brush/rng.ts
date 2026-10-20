// Port of libmypaint's rng-double.c, itself Knuth's ranarray generator (public domain),
// with libmypaint's reduced quality parameters. Pure double arithmetic, so results are identical on every engine.

const QUALITY = 19;
const TT = 7;
const KK = 10;
const LL = 7;

function modSum(x: number, y: number): number {
  const sum = x + y;
  return sum - Math.trunc(sum);
}

/** Deterministic random generator in [0, 1). */
export class RngDouble {
  readonly #ranU = new Float64Array(KK);
  readonly #buf = new Float64Array(QUALITY);
  /** Index into `#buf` of the next value, or -1 when a new cycle is needed. */
  #ptr = -1;

  constructor(seed: number) {
    this.setSeed(seed);
  }

  #getArray(aa: Float64Array, n: number): void {
    const ranU = this.#ranU;
    let j: number;
    for (j = 0; j < KK; j++) aa[j] = ranU[j]!;
    for (; j < n; j++) aa[j] = modSum(aa[j - KK]!, aa[j - LL]!);
    let i: number;
    for (i = 0; i < LL; i++, j++) ranU[i] = modSum(aa[j - KK]!, aa[j - LL]!);
    for (; i < KK; i++, j++) ranU[i] = modSum(aa[j - KK]!, ranU[i - LL]!);
  }

  setSeed(seed: number): void {
    const u = new Float64Array(KK + KK - 1);
    const ulp = 1 / 2 ** 30 / 2 ** 22;
    let ss = 2 * ulp * ((seed & 0x3fffffff) + 2);
    for (let j = 0; j < KK; j++) {
      u[j] = ss;
      ss += ss;
      if (ss >= 1) ss -= 1 - 2 * ulp;
    }
    u[1]! += ulp;
    for (let s = seed & 0x3fffffff, t = TT - 1; t; ) {
      for (let j = KK - 1; j > 0; j--) {
        u[j + j] = u[j]!;
        u[j + j - 1] = 0;
      }
      for (let j = KK + KK - 2; j >= KK; j--) {
        u[j - (KK - LL)] = modSum(u[j - (KK - LL)]!, u[j]!);
        u[j - KK] = modSum(u[j - KK]!, u[j]!);
      }
      if (s & 1) {
        for (let j = KK; j > 0; j--) u[j] = u[j - 1]!;
        u[0] = u[KK]!;
        u[LL] = modSum(u[LL]!, u[KK]!);
      }
      if (s) s >>= 1;
      else t--;
    }
    let j: number;
    for (j = 0; j < LL; j++) this.#ranU[j + KK - LL] = u[j]!;
    for (; j < KK; j++) this.#ranU[j - LL] = u[j]!;
    for (j = 0; j < 10; j++) this.#getArray(u, KK + KK - 1);
    this.#ptr = -1;
  }

  next(): number {
    if (this.#ptr >= 0 && this.#buf[this.#ptr]! >= 0) return this.#buf[this.#ptr++]!;
    this.#getArray(this.#buf, QUALITY);
    this.#buf[KK] = -1;
    this.#ptr = 1;
    return this.#buf[0]!;
  }

  /** Approximately normal distribution with mean 0 and variance 1. Port of `rand_gauss`. */
  gauss(): number {
    const sum = this.next() + this.next() + this.next() + this.next();
    return sum * 1.73205080757 - 3.46410161514;
  }
}
