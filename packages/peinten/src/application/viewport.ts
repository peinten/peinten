import { type Affine2D, applyAffine, invertAffine } from '../domain/geometry/affine.ts';

/** How a document is placed on a canvas. */
export interface Viewport {
  /** Document coordinate shown at the canvas center. */
  readonly centerX: number;
  readonly centerY: number;
  /** Screen pixels per document pixel. */
  readonly zoom: number;
  /** Radians, clockwise. */
  readonly rotation: number;
  readonly flipX: boolean;
}

export const DEFAULT_VIEWPORT: Viewport = { centerX: 0, centerY: 0, zoom: 1, rotation: 0, flipX: false };

/** Size of the canvas in device pixels. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/** Matrix from document pixels to canvas device pixels. */
export function documentToScreen(viewport: Viewport, size: CanvasSize): Affine2D {
  const z = viewport.zoom;
  const cos = Math.cos(viewport.rotation) * z;
  const sin = Math.sin(viewport.rotation) * z;
  const fx = viewport.flipX ? -1 : 1;
  // screen = center + R * S * F * (doc - viewCenter)
  const a = cos * fx;
  const b = sin * fx;
  const c = -sin;
  const d = cos;
  const e = size.width / 2 - (a * viewport.centerX + c * viewport.centerY);
  const f = size.height / 2 - (b * viewport.centerX + d * viewport.centerY);
  return [a, b, c, d, e, f];
}

export function screenToDocument(viewport: Viewport, size: CanvasSize): Affine2D {
  return invertAffine(documentToScreen(viewport, size));
}

/** Viewport that fits the whole document into the canvas with a small margin. */
export function fitViewport(docWidth: number, docHeight: number, size: CanvasSize, margin = 0.92): Viewport {
  const zoom = Math.min(size.width / docWidth, size.height / docHeight) * margin;
  return { centerX: docWidth / 2, centerY: docHeight / 2, zoom: zoom > 0 ? zoom : 1, rotation: 0, flipX: false };
}

/** Zooms by `factor` keeping the document point under the given screen position fixed. */
export function zoomAt(
  viewport: Viewport,
  size: CanvasSize,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const [docX, docY] = applyAffine(screenToDocument(viewport, size), screenX, screenY);
  const zoom = Math.min(Math.max(viewport.zoom * factor, 0.01), 256);
  const next = { ...viewport, zoom };
  const [sx, sy] = applyAffine(documentToScreen(next, size), docX, docY);
  return panBy(next, size, screenX - sx, screenY - sy);
}

/** Moves the view so that content follows the pointer by (dx, dy) screen pixels. */
export function panBy(viewport: Viewport, size: CanvasSize, dx: number, dy: number): Viewport {
  const inv = screenToDocument(viewport, size);
  const [x0, y0] = applyAffine(inv, 0, 0);
  const [x1, y1] = applyAffine(inv, dx, dy);
  return { ...viewport, centerX: viewport.centerX - (x1 - x0), centerY: viewport.centerY - (y1 - y0) };
}

/** Rotates the view by `radians` keeping the document point under the screen position fixed. */
export function rotateAt(
  viewport: Viewport,
  size: CanvasSize,
  screenX: number,
  screenY: number,
  radians: number,
): Viewport {
  const [docX, docY] = applyAffine(screenToDocument(viewport, size), screenX, screenY);
  const next = { ...viewport, rotation: viewport.rotation + radians };
  const [sx, sy] = applyAffine(documentToScreen(next, size), docX, docY);
  return panBy(next, size, screenX - sx, screenY - sy);
}
