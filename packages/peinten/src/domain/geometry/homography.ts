/** Row-major 3x3 matrix mapping (u, v, 1) to homogeneous (X, Y, W). */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/**
 * Projective map from the unit square to a quad (Heckbert, "Fundamentals of Texture Mapping and Image Warping").
 * Corners are given clockwise from (0,0): top-left, top-right, bottom-right, bottom-left, as a flat array.
 */
export function squareToQuad(q: readonly number[]): Homography {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q as [number, number, number, number, number, number, number, number];
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

/** Samples a homography on a regular grid as a warp mesh of [X, Y, W] vertices. */
export function homographyMesh(h: Homography, cols: number, rows: number): number[] {
  const points: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      points.push(h[0] * u + h[1] * v + h[2], h[3] * u + h[4] * v + h[5], h[6] * u + h[7] * v + h[8]);
    }
  }
  return points;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Smooth warp mesh through a grid of control points, using a Catmull-Rom surface (bicubic, interpolating).
 * @param control (n+1)*(n+1) points as flat [x, y]
 * @param subdivisions vertices added per control cell along each axis
 */
export function controlGridMesh(control: readonly number[], n: number, subdivisions: number): number[] {
  const at = (i: number, j: number, axis: number) => {
    const ci = Math.min(Math.max(i, 0), n);
    const cj = Math.min(Math.max(j, 0), n);
    // Extrapolate linearly beyond the border so edge cells do not bulge.
    const base = control[(cj * (n + 1) + ci) * 2 + axis]!;
    const di = i - ci;
    const dj = j - cj;
    if (di === 0 && dj === 0) return base;
    const ni = Math.min(Math.max(ci - di, 0), n);
    const nj = Math.min(Math.max(cj - dj, 0), n);
    return 2 * base - control[(nj * (n + 1) + ni) * 2 + axis]!;
  };
  const size = n * subdivisions;
  const points: number[] = [];
  for (let y = 0; y <= size; y++) {
    const cj = Math.min(Math.floor(y / subdivisions), n - 1);
    const ty = y / subdivisions - cj;
    for (let x = 0; x <= size; x++) {
      const ci = Math.min(Math.floor(x / subdivisions), n - 1);
      const tx = x / subdivisions - ci;
      for (let axis = 0; axis < 2; axis++) {
        const rows: number[] = [];
        for (let dj = -1; dj <= 2; dj++) {
          rows.push(
            catmullRom(
              at(ci - 1, cj + dj, axis),
              at(ci, cj + dj, axis),
              at(ci + 1, cj + dj, axis),
              at(ci + 2, cj + dj, axis),
              tx,
            ),
          );
        }
        points.push(catmullRom(rows[0]!, rows[1]!, rows[2]!, rows[3]!, ty));
      }
      points.push(1);
    }
  }
  return points;
}
