import type { ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import { type SelectionMode, selectionCoverage } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';

/** Drag distance in screen pixels below which a press counts as a click. */
const CLICK_DISTANCE = 3;

/**
 * Moves the selection outline for selection tools. A press inside the selection in replace mode is held back:
 * dragging moves the outline by whole pixels, while releasing without dragging hands the click back to the tool.
 */
export class SelectionMove {
  #drag: { pointerId: number; x0: number; y0: number; sx: number; sy: number; moving: boolean } | null = null;

  /** Returns true when the press may start a move; the tool then waits for `release`. */
  press(e: ToolPointerEvent, mode: SelectionMode, ctx: ToolContext): boolean {
    const selection = ctx.document.selection;
    if (mode !== 'replace' || ctx.document.quickMask || !selection) return false;
    if (selectionCoverage(selection, e.x, e.y) < 0.5) return false;
    this.#drag = { pointerId: e.pointerId, x0: e.x, y0: e.y, sx: e.screenX, sy: e.screenY, moving: false };
    return true;
  }

  /** Returns true when the event belongs to a pending or active move. */
  drag(e: ToolPointerEvent, ctx: ToolContext): boolean {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return false;
    if (!drag.moving && Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) < CLICK_DISTANCE) return true;
    drag.moving = true;
    ctx.preview.setSelectionOffset({ x: Math.round(e.x - drag.x0), y: Math.round(e.y - drag.y0) });
    return true;
  }

  /** 'moved' after a drag, 'click' when released without dragging, null when the event is not part of a move. */
  release(e: ToolPointerEvent, ctx: ToolContext): 'moved' | 'click' | null {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return null;
    this.#drag = null;
    if (!drag.moving) return 'click';
    const dx = Math.round(e.x - drag.x0);
    const dy = Math.round(e.y - drag.y0);
    if (dx === 0 && dy === 0) {
      ctx.preview.setSelectionOffset(null);
      return 'moved';
    }
    // Keep the shifted preview until the moved mask is in the state, so the outline does not jump back for a frame.
    void ctx.document.submit(ops.moveSelection({ dx, dy })).finally(() => ctx.preview.setSelectionOffset(null));
    return 'moved';
  }

  cancel(ctx: ToolContext): void {
    if (this.#drag?.moving) ctx.preview.setSelectionOffset(null);
    this.#drag = null;
  }
}
