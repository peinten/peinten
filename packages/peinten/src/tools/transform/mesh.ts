import type { OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import { controlGridMesh, squareToQuad } from '../../domain/geometry/homography.ts';
import { hitPoint, type TransformMode } from './mode.ts';

/** Render-mesh vertices per control cell; enough for the curved interpolation to look smooth. */
const SUBDIVISIONS = 8;

/** Mesh warp: a grid of control points interpolated with a bicubic (Catmull-Rom) surface. */
export class MeshMode implements TransformMode {
  readonly #n: number;
  #control: number[];
  #drag: { index: number; x: number; y: number; start: number[] } | null = null;

  /** Places an n x n control grid on the projective map through `corners`. */
  constructor(corners: readonly number[], n: number) {
    this.#n = n;
    const h = squareToQuad(corners);
    this.#control = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const v = j / n;
        const w = h[6] * u + h[7] * v + h[8];
        this.#control.push((h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w);
      }
    }
  }

  #point(i: number, j: number): [number, number] {
    const o = (j * (this.#n + 1) + i) * 2;
    return [this.#control[o]!, this.#control[o + 1]!];
  }

  corners(): number[] {
    const n = this.#n;
    return [...this.#point(0, 0), ...this.#point(n, 0), ...this.#point(n, n), ...this.#point(0, n)];
  }

  mesh() {
    const size = this.#n * SUBDIVISIONS;
    return { cols: size, rows: size, points: controlGridMesh(this.#control, this.#n, SUBDIVISIONS) };
  }

  begin(e: ToolPointerEvent, ctx: ToolContext): void {
    this.#drag = { index: hitPoint(this.#control, e, ctx), x: e.x, y: e.y, start: [...this.#control] };
  }

  /** Dragging a control point moves it; dragging elsewhere moves the whole grid. */
  drag(e: ToolPointerEvent): void {
    const d = this.#drag;
    if (!d) return;
    const dx = e.x - d.x;
    const dy = e.y - d.y;
    this.#control = d.start.map((value, i) => {
      const moves = d.index < 0 || Math.floor(i / 2) === d.index;
      return moves ? value + (i % 2 === 0 ? dx : dy) : value;
    });
  }

  end(): void {
    this.#drag = null;
  }

  draw(overlay: OverlayBuilder): void {
    const n = this.#n;
    for (let j = 0; j <= n; j++) {
      const row: number[] = [];
      const column: number[] = [];
      for (let i = 0; i <= n; i++) {
        row.push(...this.#point(i, j));
        column.push(...this.#point(j, i));
      }
      overlay.polyline(row, { width: 1 });
      overlay.polyline(column, { width: 1 });
    }
    for (let i = 0; i < this.#control.length; i += 2)
      overlay.handle(this.#control[i]!, this.#control[i + 1]!, { shape: 'circle', size: 7 });
  }
}
