import type { ITool, ToolContext, ToolPointerEvent } from '../application/tool.ts';

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
}

function startDrag(e: ToolPointerEvent): Drag {
  return { pointerId: e.pointerId, startX: e.screenX, startY: e.screenY, x: e.screenX, y: e.screenY };
}

/** Drags the view. */
export class PanTool implements ITool<'pan', Record<string, never>> {
  readonly id = 'pan';
  readonly defaultOptions = {};
  #drag: Drag | null = null;

  onPointerDown(e: ToolPointerEvent): void {
    this.#drag = startDrag(e);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    ctx.viewport.panBy(e.screenX - drag.x, e.screenY - drag.y);
    drag.x = e.screenX;
    drag.y = e.screenY;
  }

  onPointerUp(): void {
    this.#drag = null;
  }

  onPointerCancel(): void {
    this.#drag = null;
  }
}

/** Dragging up zooms in around the press point; a click zooms in, Alt-click zooms out. */
export class ZoomTool implements ITool<'zoom', Record<string, never>> {
  readonly id = 'zoom';
  readonly defaultOptions = {};
  #drag: Drag | null = null;

  onPointerDown(e: ToolPointerEvent): void {
    this.#drag = startDrag(e);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    ctx.viewport.zoomAt(drag.startX, drag.startY, Math.exp((drag.y - e.screenY) * 0.005));
    drag.y = e.screenY;
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    this.#drag = null;
    if (drag && Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY) < 3) {
      ctx.viewport.zoomAt(e.screenX, e.screenY, e.modifiers.alt ? 0.5 : 2);
    }
  }

  onPointerCancel(): void {
    this.#drag = null;
  }
}

/** Rotates the view around its center by dragging around it. Shift snaps to 15 degree steps. */
export class RotateTool implements ITool<'rotate', Record<string, never>> {
  readonly id = 'rotate';
  readonly defaultOptions = {};
  #drag: (Drag & { angle: number; base: number }) | null = null;

  #angle(e: ToolPointerEvent, ctx: ToolContext): number {
    const { width, height } = ctx.viewport.size;
    return Math.atan2(e.screenY - height / 2, e.screenX - width / 2);
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.#drag = { ...startDrag(e), angle: this.#angle(e, ctx), base: ctx.viewport.get().rotation };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    let target = drag.base + this.#angle(e, ctx) - drag.angle;
    if (e.modifiers.shift) target = Math.round(target / (Math.PI / 12)) * (Math.PI / 12);
    const { width, height } = ctx.viewport.size;
    ctx.viewport.rotateAt(width / 2, height / 2, target - ctx.viewport.get().rotation);
  }

  onPointerUp(): void {
    this.#drag = null;
  }

  onPointerCancel(): void {
    this.#drag = null;
  }
}
