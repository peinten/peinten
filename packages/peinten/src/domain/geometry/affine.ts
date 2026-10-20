/** 2D affine matrix in canvas `setTransform` order: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine2D = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY_AFFINE: Affine2D = [1, 0, 0, 1, 0, 0];

export function applyAffine(m: Affine2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
export function invertAffine(m: Affine2D): Affine2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) throw new Error('Affine matrix is not invertible');
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

/** Returns `m * n`, i.e. `n` is applied first. */
export function multiplyAffine(m: Affine2D, n: Affine2D): Affine2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
