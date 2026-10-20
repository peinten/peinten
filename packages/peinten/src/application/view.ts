import { applyAffine } from '../domain/geometry/affine.ts';
import type { LocalDocument } from './document.ts';
import { EMPTY_OVERLAY, OverlayBuilder, type OverlayShape } from './overlay.ts';
import type { ViewBackground, ViewSurface } from './ports/renderer.ts';
import type { PointerInput, ToolKeyEvent, ToolPointerEvent } from './tool.ts';
import {
  type CanvasSize,
  DEFAULT_VIEWPORT,
  documentToScreen,
  fitViewport,
  panBy,
  screenToDocument,
  type Viewport,
  zoomAt,
} from './viewport.ts';

export interface ViewSnapshot {
  readonly viewport: Viewport;
}

export interface WheelInput {
  readonly screenX: number;
  readonly screenY: number;
  /** Device pixels. */
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** What a view needs from the runtime: the active tool and a context bound to this view. */
export interface ToolHost {
  pointer(view: LocalView, kind: PointerInput['kind'], event: ToolPointerEvent): void;
  key(view: LocalView, kind: 'down' | 'up', event: ToolKeyEvent): void;
  overlay(view: LocalView, builder: OverlayBuilder): void;
  /** Forgets this view, cancelling the tool's work if it was bound to it. */
  detach(view: LocalView): void;
}

const ERASER_BUTTON = 32;

/** A canvas showing a document. Translates screen input into document space and routes it to tools. */
export class LocalView {
  readonly document: LocalDocument;
  readonly #surface: ViewSurface;
  readonly #host: ToolHost | null;
  readonly #navigation: boolean;
  #background: ViewBackground;
  #viewport: Viewport = DEFAULT_VIEWPORT;
  #size: CanvasSize = { width: 0, height: 0, devicePixelRatio: 1 };
  #fitted = false;
  #snapshot: ViewSnapshot = { viewport: DEFAULT_VIEWPORT };
  readonly #listeners = new Set<() => void>();
  readonly #removeFrameListener: () => void;
  #spaceHeld = false;
  #pan: { pointerId: number; x: number; y: number } | null = null;
  #overlay: readonly OverlayShape[] = [];

  constructor(
    document: LocalDocument,
    surface: ViewSurface,
    options: { host: ToolHost | null; navigation: boolean; background: ViewBackground },
  ) {
    this.document = document;
    this.#surface = surface;
    this.#host = options.host;
    this.#navigation = options.navigation;
    this.#background = options.background;
    this.#removeFrameListener = document.addFrameListener(this);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): ViewSnapshot => this.#snapshot;

  get viewport(): Viewport {
    return this.#viewport;
  }

  get size(): CanvasSize {
    return this.#size;
  }

  setViewport(viewport: Partial<Viewport>): void {
    this.#viewport = { ...this.#viewport, ...viewport };
    this.#snapshot = { viewport: this.#viewport };
    for (const listener of this.#listeners) listener();
    this.document.requestFrame();
  }

  /** Called when the canvas element changes size. The first call fits the document into the view. */
  resize(size: CanvasSize): void {
    this.#size = size;
    this.#surface.resize(size);
    if (!this.#fitted && size.width > 0 && size.height > 0) {
      this.#fitted = true;
      this.setViewport(fitViewport(this.document.width, this.document.height, size, this.#host ? 0.92 : 1));
      return;
    }
    this.document.requestFrame();
  }

  toDocument(screenX: number, screenY: number): [number, number] {
    return applyAffine(screenToDocument(this.#viewport, this.#size), screenX, screenY);
  }

  toScreen(x: number, y: number): [number, number] {
    return applyAffine(documentToScreen(this.#viewport, this.#size), x, y);
  }

  #toToolEvent(input: PointerInput): ToolPointerEvent {
    const [x, y] = this.toDocument(input.screenX, input.screenY);
    const { rotation, flipX } = this.#viewport;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const tx = input.tiltX * cos - input.tiltY * sin;
    const ty = input.tiltX * sin + input.tiltY * cos;
    const degrees = (rotation * 180) / Math.PI;
    const twist = (((input.twist - degrees) % 360) + 360) % 360;
    return {
      ...input,
      x,
      y,
      docTiltX: flipX ? -tx : tx,
      docTiltY: ty,
      docTwist: flipX ? (360 - twist) % 360 : twist,
      eraserTip: input.pointerType === 'pen' && (input.buttons & ERASER_BUTTON) !== 0,
    };
  }

  /** Feeds normalized pointer samples, coalesced moves included. */
  handlePointer(inputs: readonly PointerInput[]): void {
    for (const input of inputs) {
      if (this.#navigation && this.#handleNavigation(input)) continue;
      this.#host?.pointer(this, input.kind, this.#toToolEvent(input));
    }
    // Collaborators see this pointer as a cursor.
    const last = inputs.at(-1);
    if (!last) return;
    const [x, y] = this.toDocument(last.screenX, last.screenY);
    this.document.setCursor(last.kind === 'cancel' ? null : { x, y });
  }

  /** Space-drag and middle-button drag pan the view without involving the active tool. */
  #handleNavigation(input: PointerInput): boolean {
    if (input.kind === 'down' && (this.#spaceHeld || input.button === 1)) {
      this.#pan = { pointerId: input.pointerId, x: input.screenX, y: input.screenY };
      return true;
    }
    const pan = this.#pan;
    if (!pan || pan.pointerId !== input.pointerId) return false;
    if (input.kind === 'move') {
      this.setViewport(panBy(this.#viewport, this.#size, input.screenX - pan.x, input.screenY - pan.y));
      pan.x = input.screenX;
      pan.y = input.screenY;
    } else {
      this.#pan = null;
    }
    return true;
  }

  /** Ctrl/Cmd + wheel (and trackpad pinch) zooms at the pointer; plain wheel pans. */
  handleWheel(input: WheelInput): void {
    if (!this.#navigation) return;
    if (input.ctrlKey || input.metaKey) {
      this.setViewport(
        zoomAt(this.#viewport, this.#size, input.screenX, input.screenY, Math.exp(-input.deltaY * 0.01)),
      );
    } else {
      this.setViewport(panBy(this.#viewport, this.#size, -input.deltaX, -input.deltaY));
    }
  }

  handleKey(kind: 'down' | 'up', event: ToolKeyEvent): void {
    if (event.code === 'Space') {
      this.#spaceHeld = kind === 'down';
      return;
    }
    this.#host?.key(this, kind, event);
  }

  /** Shapes the app draws over this view, under the active tool's overlay. They stay until replaced. */
  setOverlay(shapes: readonly OverlayShape[]): void {
    this.#overlay = shapes;
    this.document.requestFrame();
  }

  /** Called by the document's frame loop after the composite is up to date. */
  frame(time: number): boolean {
    if (this.#size.width === 0) return false;
    let overlay = EMPTY_OVERLAY;
    if (this.#host || this.#overlay.length > 0) {
      const builder = new OverlayBuilder(documentToScreen(this.#viewport, this.#size), this.#size.devicePixelRatio);
      builder.shapes(this.#overlay);
      this.#host?.overlay(this, builder);
      overlay = builder.build();
    }
    this.#surface.render(this.#viewport, overlay, this.#background, time / 1000);
    const snapshot = this.document.getSnapshot();
    // Marching ants are animated, so keep drawing while there is a selection.
    return snapshot.selection !== null && !snapshot.quickMask;
  }

  dispose(): void {
    this.#removeFrameListener();
    this.#host?.detach(this);
    this.#surface.dispose();
  }
}
