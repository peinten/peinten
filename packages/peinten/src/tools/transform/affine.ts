import type { OverlayBuilder, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import { type Affine2D, applyAffine, invertAffine } from '../../domain/geometry/affine.ts';
import type { Rect } from '../../domain/tiles/tile-map.ts';
import { hitPoint, insidePolygon, type TransformMode } from './mode.ts';

/** Placement of the box: center, scale, rotation and horizontal shear. */
interface Params {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  rotation: number;
  shear: number;
}

/** Handle directions: corners and edge midpoints, clockwise from top-left. */
const HANDLES = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
] as const;

type Drag =
  | { kind: 'move'; x: number; y: number; start: Params }
  | { kind: 'scale'; hx: number; hy: number; start: Params }
  | { kind: 'shear'; hy: number; startX: number; start: Params }
  | { kind: 'rotate'; angle: number; start: Params };

/**
 * Move, scale, rotate, shear and flip. Corner handles scale both axes (Shift keeps proportions), edge handles one axis
 * (Ctrl on the top or bottom edge shears), dragging inside moves, outside rotates (Shift snaps to 15 degrees).
 */
export class AffineMode implements TransformMode {
  readonly #source: Rect;
  #p: Params;
  #drag: Drag | null = null;

  constructor(source: Rect, params?: Params) {
    this.#source = source;
    this.#p = params ?? {
      cx: source.x + source.width / 2,
      cy: source.y + source.height / 2,
      sx: 1,
      sy: 1,
      rotation: 0,
      shear: 0,
    };
  }

  /** Approximates a quad by the parallelogram through its top-left, top-right and bottom-left corners. */
  static fromCorners(source: Rect, c: readonly number[]): AffineMode {
    const ex = [c[2]! - c[0]!, c[3]! - c[1]!];
    const ey = [c[6]! - c[0]!, c[7]! - c[1]!];
    const rotation = Math.atan2(ex[1]!, ex[0]!);
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const eyx = ey[0]! * cos - ey[1]! * sin;
    const eyy = ey[0]! * sin + ey[1]! * cos;
    return new AffineMode(source, {
      cx: (c[2]! + c[6]!) / 2,
      cy: (c[3]! + c[7]!) / 2,
      sx: Math.hypot(ex[0]!, ex[1]!) / source.width,
      sy: eyy / source.height,
      rotation,
      shear: eyy === 0 ? 0 : eyx / eyy,
    });
  }

  /** Frame matrix R * Shear applied to scaled box coordinates. */
  #frame(p: Params): Affine2D {
    const cos = Math.cos(p.rotation);
    const sin = Math.sin(p.rotation);
    return [cos, sin, cos * p.shear - sin, sin * p.shear + cos, p.cx, p.cy];
  }

  /** Maps document pixels inside the source rectangle to their transformed position. */
  matrix(): Affine2D {
    const p = this.#p;
    const f = this.#frame(p);
    const ox = -(this.#source.x + this.#source.width / 2);
    const oy = -(this.#source.y + this.#source.height / 2);
    const a = f[0] * p.sx;
    const b = f[1] * p.sx;
    const c = f[2] * p.sy;
    const d = f[3] * p.sy;
    return [a, b, c, d, a * ox + c * oy + f[4], b * ox + d * oy + f[5]];
  }

  #local(hx: number, hy: number): [number, number] {
    return applyAffine(
      this.matrix(),
      this.#source.x + ((hx + 1) / 2) * this.#source.width,
      this.#source.y + ((hy + 1) / 2) * this.#source.height,
    );
  }

  corners(): number[] {
    return [...this.#local(-1, -1), ...this.#local(1, -1), ...this.#local(1, 1), ...this.#local(-1, 1)];
  }

  mesh() {
    const c = this.corners();
    return { cols: 1, rows: 1, points: [c[0]!, c[1]!, 1, c[2]!, c[3]!, 1, c[6]!, c[7]!, 1, c[4]!, c[5]!, 1] };
  }

  flip(axis: 'x' | 'y'): void {
    if (axis === 'x') this.#p = { ...this.#p, sx: -this.#p.sx };
    else this.#p = { ...this.#p, sy: -this.#p.sy };
  }

  begin(e: ToolPointerEvent, ctx: ToolContext): void {
    const start = { ...this.#p };
    const handles = HANDLES.flatMap(([hx, hy]) => this.#local(hx, hy));
    const hit = hitPoint(handles, e, ctx);
    if (hit >= 0) {
      const [hx, hy] = HANDLES[hit]!;
      this.#drag =
        hx === 0 && e.modifiers.ctrl
          ? { kind: 'shear', hy, startX: this.#frameCoords(start, e.x, e.y, false)[0], start }
          : { kind: 'scale', hx, hy, start };
      return;
    }
    if (insidePolygon(this.corners(), e.x, e.y)) {
      this.#drag = { kind: 'move', x: e.x, y: e.y, start };
      return;
    }
    this.#drag = { kind: 'rotate', angle: Math.atan2(e.y - start.cy, e.x - start.cx), start };
  }

  /** Pointer in box-aligned coordinates relative to the start center, with or without undoing the shear. */
  #frameCoords(p: Params, x: number, y: number, withShear: boolean): [number, number] {
    const inverse = invertAffine(
      withShear
        ? this.#frame(p)
        : [Math.cos(p.rotation), Math.sin(p.rotation), -Math.sin(p.rotation), Math.cos(p.rotation), p.cx, p.cy],
    );
    return applyAffine(inverse, x, y);
  }

  drag(e: ToolPointerEvent): void {
    const d = this.#drag;
    if (!d) return;
    const s = d.start;
    const { width: w, height: h } = this.#source;
    switch (d.kind) {
      case 'move':
        this.#p = { ...s, cx: s.cx + e.x - d.x, cy: s.cy + e.y - d.y };
        return;
      case 'rotate': {
        let rotation = s.rotation + Math.atan2(e.y - s.cy, e.x - s.cx) - d.angle;
        if (e.modifiers.shift) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
        this.#p = { ...s, rotation };
        return;
      }
      case 'shear': {
        const x = this.#frameCoords(s, e.x, e.y, false)[0];
        this.#p = { ...s, shear: s.shear + (x - d.startX) / ((d.hy * s.sy * h) / 2) };
        return;
      }
      case 'scale': {
        const [px, py] = this.#frameCoords(s, e.x, e.y, true);
        const anchorX = (-d.hx * s.sx * w) / 2;
        const anchorY = (-d.hy * s.sy * h) / 2;
        let sx = d.hx ? (px - anchorX) / (d.hx * w) : s.sx;
        let sy = d.hy ? (py - anchorY) / (d.hy * h) : s.sy;
        if (e.modifiers.shift && d.hx && d.hy) {
          const f = Math.max(Math.abs(sx / s.sx), Math.abs(sy / s.sy));
          sx = Math.sign(sx || 1) * Math.abs(s.sx) * f;
          sy = Math.sign(sy || 1) * Math.abs(s.sy) * f;
        }
        const centerX = d.hx ? anchorX + (d.hx * sx * w) / 2 : 0;
        const centerY = d.hy ? anchorY + (d.hy * sy * h) / 2 : 0;
        const [cx, cy] = applyAffine(this.#frame(s), centerX, centerY);
        this.#p = { ...s, sx, sy, cx, cy };
        return;
      }
    }
  }

  end(): void {
    this.#drag = null;
  }

  draw(overlay: OverlayBuilder): void {
    overlay.polyline(this.corners(), { closed: true, width: 1 });
    for (const [hx, hy] of HANDLES) {
      const [x, y] = this.#local(hx, hy);
      overlay.handle(x, y);
    }
    const [cx, cy] = [this.#p.cx, this.#p.cy];
    overlay.handle(cx, cy, { shape: 'circle', size: 6 });
  }
}
