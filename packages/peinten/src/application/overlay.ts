import earcut from 'earcut';
import { type Affine2D, applyAffine } from '../domain/geometry/affine.ts';
import { strokePolyline } from '../domain/geometry/polyline.ts';

/** Straight RGBA in 0..1. */
export type OverlayColor = readonly [number, number, number, number];

/**
 * Triangles to draw over the canvas, in canvas device pixels.
 * Vertex layout: x, y, r, g, b, a, dash. `dash` < 0 means solid; otherwise it is the distance along a dashed line.
 */
export interface OverlayGeometry {
  readonly vertices: Float32Array;
}

export const OVERLAY_VERTEX_FLOATS = 7;
export const EMPTY_OVERLAY: OverlayGeometry = { vertices: new Float32Array(0) };

export type OverlaySpace = 'document' | 'screen';

interface LineStyle {
  readonly color?: OverlayColor;
  /** Width in screen pixels. */
  readonly width?: number;
  readonly dashed?: boolean;
  readonly closed?: boolean;
  readonly space?: OverlaySpace;
  /** Draws a dark outline under the line so it stays visible on any background. */
  readonly outline?: boolean;
}

interface HandleStyle {
  readonly shape?: 'square' | 'circle';
  /** Size in screen pixels. */
  readonly size?: number;
  readonly fill?: OverlayColor;
  readonly stroke?: OverlayColor;
  readonly space?: OverlaySpace;
}

const WHITE: OverlayColor = [1, 1, 1, 1];
const BLACK: OverlayColor = [0, 0, 0, 0.85];

/** Vector primitives tools draw over the canvas. Coordinates default to document pixels. */
export class OverlayBuilder {
  readonly #toScreen: Affine2D;
  readonly #scale: number;
  readonly #data: number[] = [];

  /** @param scale device pixels per CSS pixel, so widths stay visually constant */
  constructor(documentToScreen: Affine2D, scale: number) {
    this.#toScreen = documentToScreen;
    this.#scale = scale;
  }

  #project(points: readonly number[], space: OverlaySpace): number[] {
    if (space === 'screen') return points.map((v) => v * this.#scale);
    const out: number[] = [];
    for (let i = 0; i < points.length; i += 2) out.push(...applyAffine(this.#toScreen, points[i]!, points[i + 1]!));
    return out;
  }

  #push(triangles: number[], color: OverlayColor, dashed: boolean): void {
    for (let i = 0; i < triangles.length; i += 3) {
      this.#data.push(
        triangles[i]!,
        triangles[i + 1]!,
        color[0],
        color[1],
        color[2],
        color[3],
        dashed ? triangles[i + 2]! : -1,
      );
    }
  }

  /** Draws a line through `points` given as flat [x0, y0, x1, y1, ...]. */
  polyline(points: readonly number[], style: LineStyle = {}): void {
    const screen = this.#project(points, style.space ?? 'document');
    const width = (style.width ?? 1) * this.#scale;
    if (style.outline ?? true) {
      const outline: number[] = [];
      strokePolyline(screen, width + 2 * this.#scale, style.closed ?? false, outline);
      this.#push(outline, BLACK, false);
    }
    const tris: number[] = [];
    strokePolyline(screen, width, style.closed ?? false, tris);
    this.#push(tris, style.color ?? WHITE, style.dashed ?? false);
  }
  /** Fills a polygon already in device pixels. */
  #fill(screen: number[], color: OverlayColor): void {
    const indices = earcut(screen);
    const tris: number[] = [];
    for (const index of indices) tris.push(screen[index * 2]!, screen[index * 2 + 1]!, 0);
    this.#push(tris, color, false);
  }

  /** Draws a transform or vertex handle centred on (x, y). */
  handle(x: number, y: number, style: HandleStyle = {}): void {
    const [cx, cy] =
      (style.space ?? 'document') === 'screen' ? [x * this.#scale, y * this.#scale] : applyAffine(this.#toScreen, x, y);
    const size = (style.size ?? 9) * this.#scale;
    const r = size / 2;
    const outline = this.#shape(cx, cy, r + this.#scale, style.shape ?? 'square');
    const inner = this.#shape(cx, cy, r, style.shape ?? 'square');
    this.#fill(outline, style.stroke ?? BLACK);
    this.#fill(inner, style.fill ?? WHITE);
  }

  #shape(cx: number, cy: number, r: number, shape: 'square' | 'circle'): number[] {
    if (shape === 'square') return [cx - r, cy - r, cx + r, cy - r, cx + r, cy + r, cx - r, cy + r];
    const points: number[] = [];
    for (let i = 0; i < 16; i++)
      points.push(cx + Math.cos((i / 16) * Math.PI * 2) * r, cy + Math.sin((i / 16) * Math.PI * 2) * r);
    return points;
  }

  build(): OverlayGeometry {
    return { vertices: new Float32Array(this.#data) };
  }
}
