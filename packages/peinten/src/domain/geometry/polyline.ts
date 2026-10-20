/**
 * Triangulates a thick polyline into a triangle list. Each emitted vertex is [x, y, distance along the line].
 * Joins are mitered up to `miterLimit`, beyond which they fall back to a bevel-like clamp.
 */
export function strokePolyline(
  points: ArrayLike<number>,
  width: number,
  closed: boolean,
  out: number[],
  miterLimit = 3,
): void {
  const n = points.length >> 1;
  if (n < 2) return;
  const half = width / 2;
  const count = closed ? n + 1 : n;
  const px = (i: number) => points[(i % n) * 2]!;
  const py = (i: number) => points[(i % n) * 2 + 1]!;

  // Offset vectors at each vertex.
  const offsets: number[] = [];
  const distances: number[] = [];
  let distance = 0;
  for (let i = 0; i < count; i++) {
    const prev = i === 0 ? (closed ? n - 1 : -1) : i - 1;
    const next = i === count - 1 ? (closed ? 1 : -1) : i + 1;
    let nx = 0;
    let ny = 0;
    const normal = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return [-(by - ay) / len, (bx - ax) / len] as const;
    };
    if (prev >= 0 && next >= 0) {
      const [n1x, n1y] = normal(px(prev), py(prev), px(i), py(i));
      const [n2x, n2y] = normal(px(i), py(i), px(next), py(next));
      let mx = n1x + n2x;
      let my = n1y + n2y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const scale = Math.min(1 / Math.max(mx * n1x + my * n1y, 1e-6), miterLimit);
      nx = mx * scale;
      ny = my * scale;
    } else if (next >= 0) {
      [nx, ny] = normal(px(i), py(i), px(next), py(next));
    } else {
      [nx, ny] = normal(px(prev), py(prev), px(i), py(i));
    }
    if (i > 0) distance += Math.hypot(px(i) - px(i - 1), py(i) - py(i - 1));
    offsets.push(nx * half, ny * half);
    distances.push(distance);
  }
  for (let i = 0; i < count - 1; i++) {
    const ax = px(i);
    const ay = py(i);
    const bx = px(i + 1);
    const by = py(i + 1);
    const [aox, aoy] = [offsets[i * 2]!, offsets[i * 2 + 1]!];
    const [box, boy] = [offsets[i * 2 + 2]!, offsets[i * 2 + 3]!];
    const da = distances[i]!;
    const db = distances[i + 1]!;
    out.push(ax + aox, ay + aoy, da, ax - aox, ay - aoy, da, bx + box, by + boy, db);
    out.push(ax - aox, ay - aoy, da, bx - box, by - boy, db, bx + box, by + boy, db);
  }
}
