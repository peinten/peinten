import type { OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import type { WarpMesh } from '../../domain/raster/warp.ts';

/** Screen-pixel radius for grabbing a handle. */
export const HANDLE_RADIUS = 9;

/** One way of editing the mapping of the source rectangle. */
export interface TransformMode {
  /** Warp mesh for the current mapping. */
  mesh(): WarpMesh;
  /** Outer corners in document space, clockwise from top-left, as a flat array. Used to switch modes. */
  corners(): number[];
  /** Starts a drag for the press. */
  begin(e: ToolPointerEvent, ctx: ToolContext): void;
  drag(e: ToolPointerEvent, ctx: ToolContext): void;
  end(): void;
  draw(overlay: OverlayBuilder): void;
}

/** Index of the point within HANDLE_RADIUS screen pixels of the pointer, or -1. */
export function hitPoint(points: readonly number[], e: ToolPointerEvent, ctx: ToolContext): number {
  let best = -1;
  let bestDistance = HANDLE_RADIUS * ctx.viewport.size.devicePixelRatio;
  for (let i = 0; i < points.length; i += 2) {
    const [sx, sy] = ctx.viewport.toScreen(points[i]!, points[i + 1]!);
    const distance = Math.hypot(sx - e.screenX, sy - e.screenY);
    if (distance < bestDistance) {
      best = i / 2;
      bestDistance = distance;
    }
  }
  return best;
}

/** Even-odd point-in-polygon test. */
export function insidePolygon(points: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i]!;
    const yi = points[i + 1]!;
    const xj = points[j]!;
    const yj = points[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
