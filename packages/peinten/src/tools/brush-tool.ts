import type { ITool, OverlayBuilder, StrokeHandle, ToolContext, ToolPointerEvent } from '../application/tool.ts';
import { brushSize, resolveBrush } from '../domain/brush/resolve-brush.ts';
import type { StrokeSample } from '../domain/brush/stroke-samples.ts';

/** libmypaint expects tilt as a fraction of 60 degrees in -1..1, as Krita converts it. */
const TILT_RANGE = 60;

export interface BrushToolUIState {
  /** False when the active node cannot be painted on (a group, a text layer, a locked layer). */
  readonly canPaint: boolean;
}

/**
 * Paints with the libmypaint brush from the shared resources. The eraser is the same tool in eraser mode,
 * and the pen's eraser end switches to erasing automatically, as in Krita.
 */
export class BrushTool<Id extends string = 'brush'> implements ITool<Id, Record<string, never>, BrushToolUIState> {
  readonly id: Id;
  readonly defaultOptions = {};
  readonly #eraser: boolean;
  #stroke: { handle: StrokeHandle; pointerId: number; lastTime: number } | null = null;
  #hover: { x: number; y: number } | null = null;
  #canPaint = true;

  constructor(options: { id?: Id; eraser?: boolean } = {}) {
    this.id = options.id ?? ('brush' as Id);
    this.#eraser = options.eraser ?? false;
  }

  #sample(e: ToolPointerEvent, ctx: ToolContext, dtime: number, pressure = e.pressure): StrokeSample {
    const viewport = ctx.viewport.get();
    return {
      x: e.x,
      y: e.y,
      pressure,
      xtilt: Math.max(-1, Math.min(1, e.tiltX / TILT_RANGE)),
      ytilt: Math.max(-1, Math.min(1, e.tiltY / TILT_RANGE)),
      dtime,
      viewzoom: viewport.zoom,
      viewrotation: viewport.rotation,
      barrelRotation: e.twist / 360,
    };
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.#stroke || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const resources = ctx.resources.get();
    const brush = resolveBrush({ ...resources, eraser: this.#eraser || resources.eraser || e.eraserTip });
    const handle = ctx.beginStroke({ brush });
    this.#setCanPaint(handle !== null, ctx);
    if (!handle) return;
    this.#stroke = { handle, pointerId: e.pointerId, lastTime: e.time };
    handle.addSample(this.#sample(e, ctx, 0));
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.#hover = { x: e.x, y: e.y };
    ctx.requestOverlay();
    const stroke = this.#stroke;
    if (!stroke || stroke.pointerId !== e.pointerId) return;
    stroke.handle.addSample(this.#sample(e, ctx, (e.time - stroke.lastTime) / 1000));
    stroke.lastTime = e.time;
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const stroke = this.#stroke;
    if (!stroke || stroke.pointerId !== e.pointerId) return;
    // A final zero-pressure sample lets the brush dynamics settle like a pen lifting off.
    stroke.handle.addSample(this.#sample(e, ctx, (e.time - stroke.lastTime) / 1000, 0));
    this.#stroke = null;
    void stroke.handle.end();
  }

  onPointerCancel(): void {
    this.#stroke?.handle.cancel();
    this.#stroke = null;
  }

  deactivate(ctx: ToolContext): void {
    this.onPointerCancel();
    this.#hover = null;
    ctx.requestOverlay();
  }

  #setCanPaint(canPaint: boolean, ctx: ToolContext): void {
    if (canPaint === this.#canPaint) return;
    this.#canPaint = canPaint;
    ctx.notifyUIState();
  }

  getUIState(): BrushToolUIState {
    return { canPaint: this.#canPaint };
  }

  /** Brush outline at the pointer, sized like the dabs. */
  drawOverlay(overlay: OverlayBuilder, ctx: ToolContext): void {
    if (!this.#hover) return;
    const resources = ctx.resources.get();
    const radius = (resources.size ?? brushSize(resources.brush)) / 2;
    const points: number[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      points.push(this.#hover.x + Math.cos(a) * radius, this.#hover.y + Math.sin(a) * radius);
    }
    overlay.polyline(points, { closed: true, width: 1 });
  }
}
