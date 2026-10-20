import type { ITool, OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import type { SelectionMode } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';
import {
  DEFAULT_SELECTION_OPTIONS,
  PREVIEW_STYLE,
  resolveSelectionMode,
  type SelectionToolOptions,
} from './selection-mode.ts';
import { SelectionMove } from './selection-move.ts';

/** Minimum distance in screen pixels between recorded lasso points, to keep polygons small. */
const MIN_STEP = 2;

/** Freehand selection: the pointer path while dragging becomes a closed polygon. */
export class LassoSelectTool implements ITool<'select-lasso', SelectionToolOptions> {
  readonly id = 'select-lasso';
  readonly defaultOptions = DEFAULT_SELECTION_OPTIONS;
  #options = DEFAULT_SELECTION_OPTIONS;
  #path: { pointerId: number; mode: SelectionMode; points: number[]; lastX: number; lastY: number } | null = null;
  readonly #move = new SelectionMove();

  setOptions(options: Partial<SelectionToolOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const mode = resolveSelectionMode(this.#options.mode, e.modifiers);
    if (this.#move.press(e, mode, ctx)) return;
    this.#path = {
      pointerId: e.pointerId,
      mode,
      points: [e.x, e.y],
      lastX: e.screenX,
      lastY: e.screenY,
    };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.#move.drag(e, ctx)) return;
    const path = this.#path;
    if (!path || path.pointerId !== e.pointerId) return;
    if (Math.hypot(e.screenX - path.lastX, e.screenY - path.lastY) < MIN_STEP) return;
    path.points.push(e.x, e.y);
    path.lastX = e.screenX;
    path.lastY = e.screenY;
    ctx.requestOverlay();
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const moved = this.#move.release(e, ctx);
    if (moved === 'click') void ctx.document.submit(ops.deselect());
    if (moved) return;
    const path = this.#path;
    if (!path || path.pointerId !== e.pointerId) return;
    this.#path = null;
    ctx.requestOverlay();
    if (path.points.length < 6) {
      if (path.mode === 'replace') void ctx.document.submit(ops.deselect());
      return;
    }
    void ctx.document.submit(
      ops.selectShape({
        mode: path.mode,
        shape: { kind: 'polygon', points: path.points },
        antialias: this.#options.antialias,
      }),
    );
  }

  onPointerCancel(ctx: ToolContext): void {
    this.deactivate(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.#move.cancel(ctx);
    this.#path = null;
    ctx.requestOverlay();
  }

  drawOverlay(overlay: OverlayBuilder): void {
    if (this.#path) overlay.polyline(this.#path.points, PREVIEW_STYLE);
  }
}
