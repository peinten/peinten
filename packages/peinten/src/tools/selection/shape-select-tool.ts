import type { ITool, OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import type { SelectionMode } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';
import { ellipsePolygon } from '../../domain/raster/polygon.ts';
import {
  DEFAULT_SELECTION_OPTIONS,
  PREVIEW_STYLE,
  resolveSelectionMode,
  type SelectionToolOptions,
} from './selection-mode.ts';
import { SelectionMove } from './selection-move.ts';

/** Drag distance in screen pixels below which a press counts as a click. */
const CLICK_DISTANCE = 3;

interface Drag {
  readonly pointerId: number;
  readonly mode: SelectionMode;
  readonly x0: number;
  readonly y0: number;
  readonly sx: number;
  readonly sy: number;
  x1: number;
  y1: number;
  square: boolean;
}

/** Shape bounds of a drag, constrained to a square when requested. */
function dragBounds(d: Drag) {
  let w = d.x1 - d.x0;
  let h = d.y1 - d.y0;
  if (d.square) {
    const size = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * size;
    h = Math.sign(h || 1) * size;
  }
  return { x: Math.min(d.x0, d.x0 + w), y: Math.min(d.y0, d.y0 + h), width: Math.abs(w), height: Math.abs(h) };
}

/** Rounds a rectangle's edges to whole pixels, so it selects whole pixels like other editors' marquees. */
function snapToPixels(b: { x: number; y: number; width: number; height: number }) {
  const x = Math.round(b.x);
  const y = Math.round(b.y);
  return { x, y, width: Math.round(b.x + b.width) - x, height: Math.round(b.y + b.height) - y };
}

type ShapeToolId = 'select-rect' | 'select-ellipse';

/**
 * Rectangle or ellipse selection. Dragging defines the shape; a click without dragging deselects.
 * Holding Shift while dragging after the press constrains to a square or circle.
 */
class ShapeSelectToolClass<Id extends ShapeToolId> implements ITool<Id, SelectionToolOptions> {
  readonly id: Id;
  readonly defaultOptions = DEFAULT_SELECTION_OPTIONS;
  readonly #shape: 'rect' | 'ellipse';
  #options = DEFAULT_SELECTION_OPTIONS;
  #drag: Drag | null = null;
  readonly #move = new SelectionMove();

  constructor(shape: Id extends 'select-rect' ? 'rect' : 'ellipse') {
    this.#shape = shape;
    this.id = (shape === 'rect' ? 'select-rect' : 'select-ellipse') as Id;
  }

  setOptions(options: Partial<SelectionToolOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const mode = resolveSelectionMode(this.#options.mode, e.modifiers);
    if (this.#move.press(e, mode, ctx)) return;
    this.#drag = {
      pointerId: e.pointerId,
      mode,
      x0: e.x,
      y0: e.y,
      x1: e.x,
      y1: e.y,
      sx: e.screenX,
      sy: e.screenY,
      square: false,
    };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.#move.drag(e, ctx)) return;
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.x1 = e.x;
    drag.y1 = e.y;
    // Shift chosen before the press means "add"; pressed during the drag it constrains the shape.
    drag.square = e.modifiers.shift && drag.mode !== 'add';
    ctx.requestOverlay();
  }

  #bounds(drag: Drag) {
    const bounds = dragBounds(drag);
    return this.#shape === 'rect' ? snapToPixels(bounds) : bounds;
  }

  #outline(drag: Drag): number[] {
    const b = this.#bounds(drag);
    if (this.#shape === 'rect')
      return [b.x, b.y, b.x + b.width, b.y, b.x + b.width, b.y + b.height, b.x, b.y + b.height];
    return ellipsePolygon(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2);
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const moved = this.#move.release(e, ctx);
    // A click inside the selection deselects, like a click anywhere else in replace mode.
    if (moved === 'click') void ctx.document.submit(ops.deselect());
    if (moved) return;
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    this.#drag = null;
    ctx.requestOverlay();
    if (Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) < CLICK_DISTANCE) {
      if (drag.mode === 'replace') void ctx.document.submit(ops.deselect());
      return;
    }
    const b = this.#bounds(drag);
    const shape =
      this.#shape === 'rect'
        ? ({ kind: 'rect', ...b } as const)
        : ({
            kind: 'ellipse',
            cx: b.x + b.width / 2,
            cy: b.y + b.height / 2,
            rx: b.width / 2,
            ry: b.height / 2,
          } as const);
    void ctx.document.submit(ops.selectShape({ mode: drag.mode, shape, antialias: this.#options.antialias }));
  }

  onPointerCancel(ctx: ToolContext): void {
    this.deactivate(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.#move.cancel(ctx);
    this.#drag = null;
    ctx.requestOverlay();
  }

  drawOverlay(overlay: OverlayBuilder): void {
    if (this.#drag) overlay.polyline(this.#outline(this.#drag), { ...PREVIEW_STYLE, closed: true });
  }
}

/** The tool's id follows from the shape argument; the explicit form `new ShapeSelectTool<'select-rect'>('rect')` also works. */
interface ShapeSelectToolConstructor {
  new (shape: 'rect'): ShapeSelectToolClass<'select-rect'>;
  new (shape: 'ellipse'): ShapeSelectToolClass<'select-ellipse'>;
  new <Id extends ShapeToolId>(shape: Id extends 'select-rect' ? 'rect' : 'ellipse'): ShapeSelectToolClass<Id>;
}

export const ShapeSelectTool = ShapeSelectToolClass as ShapeSelectToolConstructor;
export type ShapeSelectTool<Id extends ShapeToolId> = ShapeSelectToolClass<Id>;
