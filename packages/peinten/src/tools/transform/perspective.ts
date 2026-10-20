import type { OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import { homographyMesh, squareToQuad } from '../../domain/geometry/homography.ts';
import { hitPoint, insidePolygon, type TransformMode } from './mode.ts';

/** Free distortion: each corner moves independently and the content follows a projective (perspective) map. */
export class PerspectiveMode implements TransformMode {
  #corners: number[];
  #drag: { index: number; x: number; y: number; start: number[] } | null = null;

  constructor(corners: readonly number[]) {
    this.#corners = [...corners];
  }

  corners(): number[] {
    return [...this.#corners];
  }

  mesh() {
    return { cols: 4, rows: 4, points: homographyMesh(squareToQuad(this.#corners), 4, 4) };
  }

  begin(e: ToolPointerEvent, ctx: ToolContext): void {
    const index = hitPoint(this.#corners, e, ctx);
    if (index < 0 && !insidePolygon(this.#corners, e.x, e.y)) return;
    this.#drag = { index, x: e.x, y: e.y, start: [...this.#corners] };
  }

  drag(e: ToolPointerEvent): void {
    const d = this.#drag;
    if (!d) return;
    const dx = e.x - d.x;
    const dy = e.y - d.y;
    this.#corners = d.start.map((value, i) => {
      const moves = d.index < 0 || Math.floor(i / 2) === d.index;
      return moves ? value + (i % 2 === 0 ? dx : dy) : value;
    });
  }

  end(): void {
    this.#drag = null;
  }

  draw(overlay: OverlayBuilder): void {
    overlay.polyline(this.#corners, { closed: true, width: 1 });
    for (let i = 0; i < 8; i += 2) overlay.handle(this.#corners[i]!, this.#corners[i + 1]!);
  }
}
