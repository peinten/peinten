import type { ITool, OverlayBuilder, ToolContext, ToolKeyEvent, ToolPointerEvent } from '../../application/tool.ts';
import type { SelectionMode } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';
import {
  DEFAULT_SELECTION_OPTIONS,
  PREVIEW_STYLE,
  resolveSelectionMode,
  type SelectionToolOptions,
} from './selection-mode.ts';
import { SelectionMove } from './selection-move.ts';

/** Screen distance within which a click on the first vertex closes the polygon. */
const CLOSE_DISTANCE = 8;
const DOUBLE_CLICK_MS = 350;

/**
 * Polygon selection: each click adds a vertex. Clicking the first vertex, double-clicking or pressing Enter closes it;
 * Escape cancels, Backspace removes the last vertex.
 */
export class PolygonSelectTool implements ITool<'select-polygon', SelectionToolOptions> {
  readonly id = 'select-polygon';
  readonly defaultOptions = DEFAULT_SELECTION_OPTIONS;
  #options = DEFAULT_SELECTION_OPTIONS;
  #polygon: { mode: SelectionMode; points: number[]; lastClick: number } | null = null;
  #cursor: { x: number; y: number } | null = null;
  readonly #move = new SelectionMove();

  setOptions(options: Partial<SelectionToolOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const polygon = this.#polygon;
    if (!polygon) {
      const mode = resolveSelectionMode(this.#options.mode, e.modifiers);
      if (!this.#move.press(e, mode, ctx)) this.#start(e, mode, ctx);
      return;
    }
    const [fx, fy] = ctx.viewport.toScreen(polygon.points[0]!, polygon.points[1]!);
    const closesOnFirst = Math.hypot(e.screenX - fx, e.screenY - fy) < CLOSE_DISTANCE;
    const doubleClick = e.time - polygon.lastClick < DOUBLE_CLICK_MS;
    if (closesOnFirst || doubleClick) {
      this.#commit(ctx);
      return;
    }
    polygon.points.push(e.x, e.y);
    polygon.lastClick = e.time;
    ctx.requestOverlay();
  }

  #start(e: ToolPointerEvent, mode: SelectionMode, ctx: ToolContext): void {
    this.#polygon = { mode, points: [e.x, e.y], lastClick: e.time };
    ctx.requestOverlay();
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    // A click inside the selection starts a polygon there, as it would anywhere else.
    if (this.#move.release(e, ctx) === 'click') this.#start(e, 'replace', ctx);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.#move.drag(e, ctx)) return;
    this.#cursor = { x: e.x, y: e.y };
    if (this.#polygon) ctx.requestOverlay();
  }

  onKeyDown(e: ToolKeyEvent, ctx: ToolContext): void {
    if (!this.#polygon) return;
    if (e.key === 'Enter') this.#commit(ctx);
    else if (e.key === 'Escape') this.deactivate(ctx);
    else if (e.key === 'Backspace') {
      this.#polygon.points.splice(-2);
      if (this.#polygon.points.length === 0) this.#polygon = null;
      ctx.requestOverlay();
    }
  }

  #commit(ctx: ToolContext): void {
    const polygon = this.#polygon;
    this.#polygon = null;
    ctx.requestOverlay();
    if (!polygon || polygon.points.length < 6) return;
    void ctx.document.submit(
      ops.selectShape({
        mode: polygon.mode,
        shape: { kind: 'polygon', points: polygon.points },
        antialias: this.#options.antialias,
      }),
    );
  }

  onPointerCancel(ctx: ToolContext): void {
    this.#move.cancel(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.#move.cancel(ctx);
    this.#polygon = null;
    ctx.requestOverlay();
  }

  drawOverlay(overlay: OverlayBuilder): void {
    const polygon = this.#polygon;
    if (!polygon) return;
    const points = this.#cursor ? [...polygon.points, this.#cursor.x, this.#cursor.y] : polygon.points;
    overlay.polyline(points, PREVIEW_STYLE);
    overlay.handle(polygon.points[0]!, polygon.points[1]!, { size: 7 });
  }
}
