import type { BrushResources } from '../domain/brush/resolve-brush.ts';
import type { BrushSettings } from '../domain/brush/settings.ts';
import type { StrokeSample } from '../domain/brush/stroke-samples.ts';
import type { ClientId, NodeId, TextLayer } from '../domain/document/nodes.ts';
import type { DocState } from '../domain/document/state.ts';
import type { OperationDraft } from '../domain/ops/operation.ts';
import type { StrokeTarget } from '../domain/ops/stroke-renderer.ts';
import type { MaskMap, TileMap } from '../domain/tiles/tile-map.ts';
import type { OverlayBuilder } from './overlay.ts';
import type { WarpPreview } from './ports/renderer.ts';
import type { CanvasSize, Viewport } from './viewport.ts';

export type { OverlayBuilder, OverlayColor } from './overlay.ts';
export type { WarpPreview } from './ports/renderer.ts';

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/** A pointer sample after browser differences are normalized, in canvas device pixels. */
export interface PointerInput {
  readonly kind: 'down' | 'move' | 'up' | 'cancel';
  readonly pointerId: number;
  readonly pointerType: 'mouse' | 'pen' | 'touch';
  readonly screenX: number;
  readonly screenY: number;
  /** 0..1; mice report 0.5 while a button is pressed. */
  readonly pressure: number;
  /** Degrees relative to the screen. */
  readonly tiltX: number;
  readonly tiltY: number;
  /** Barrel rotation in degrees, 0..359. */
  readonly twist: number;
  /** Milliseconds. */
  readonly time: number;
  readonly button: number;
  readonly buttons: number;
  readonly modifiers: Modifiers;
}

/** What tools receive: the normalized input plus document-space values. */
export interface ToolPointerEvent extends PointerInput {
  /** Document pixels. */
  readonly x: number;
  readonly y: number;
  /** Tilt with the view's rotation and flip undone, for tools that care about orientation on the document. */
  readonly docTiltX: number;
  readonly docTiltY: number;
  readonly docTwist: number;
  /** The pen's eraser end is in contact. */
  readonly eraserTip: boolean;
}

export interface ToolKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly modifiers: Modifiers;
}

/** A live stroke. Samples render immediately; `end` commits a `stroke` operation, `cancel` discards it. */
export interface StrokeHandle {
  addSample(sample: StrokeSample): void;
  end(): Promise<void>;
  cancel(): void;
}

/** Read access to the document plus the ways a tool may change it. */
export interface ToolDocument {
  readonly state: DocState;
  readonly clientId: ClientId;
  readonly activeNodeId: NodeId | null;
  readonly quickMask: boolean;
  /** This client's selection. */
  readonly selection: MaskMap | null;
  /** Rendered pixels of a text layer, if it has been rasterized. */
  textRaster(layer: TextLayer): TileMap | undefined;
  submit(drafts: OperationDraft | readonly OperationDraft[]): Promise<void>;
  setActiveNode(id: NodeId | null): void;
}

/**
 * The only window tools have into the engine, bound to the view that received the input and its document.
 * The engine knows nothing about specific tools; it only offers operations, strokes and previews.
 */
export interface ToolContext {
  readonly document: ToolDocument;
  readonly resources: { get(): BrushResources; set(resources: Partial<BrushResources>): void };
  readonly viewport: {
    get(): Viewport;
    set(viewport: Partial<Viewport>): void;
    readonly size: CanvasSize;
    toDocument(screenX: number, screenY: number): [number, number];
    toScreen(x: number, y: number): [number, number];
    /** Moves content by (dx, dy) screen pixels. */
    panBy(dx: number, dy: number): void;
    /** Zooms keeping the document point under the screen position fixed. */
    zoomAt(screenX: number, screenY: number, factor: number): void;
    /** Rotates by `radians` around the screen position. */
    rotateAt(screenX: number, screenY: number, radians: number): void;
  };
  /** Starts a live stroke on `target`, defaulting to the active layer or, in quick mask mode, the selection. */
  beginStroke(params: {
    readonly brush: BrushSettings;
    readonly target?: StrokeTarget;
    readonly seed?: number;
  }): StrokeHandle | null;
  readonly preview: {
    setWarp(preview: WarpPreview | null): void;
    /** Shows this client's selection outline shifted by whole pixels, e.g. while dragging it. */
    setSelectionOffset(offset: { readonly x: number; readonly y: number } | null): void;
  };
  requestOverlay(): void;
  notifyUIState(): void;
}

/** A tool. Implementations live outside the engine and talk to it only through `ToolContext`. */
export interface ITool<
  Id extends string = string,
  Options = unknown,
  UIState = unknown,
  Command extends string = never,
> {
  readonly id: Id;
  readonly defaultOptions: Options;
  activate?(ctx: ToolContext): void;
  /** Called when the tool is switched away or input moves to another view; unfinished work must be cancelled. */
  deactivate?(ctx: ToolContext): void;
  onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
  onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
  /** The pointer was lost (e.g. the OS took over the gesture); unfinished work must be discarded. */
  onPointerCancel?(ctx: ToolContext): void;
  onKeyDown?(e: ToolKeyEvent, ctx: ToolContext): void;
  onKeyUp?(e: ToolKeyEvent, ctx: ToolContext): void;
  setOptions?(options: Partial<Options>, ctx: ToolContext | null): void;
  /** One-shot actions from the UI, such as committing a transform. Options are state; commands are events. */
  runCommand?(command: Command, ctx: ToolContext | null): void;
  /** Structured-clone friendly state shown by the UI, e.g. whether a transform can be committed. */
  getUIState?(): UIState;
  drawOverlay?(overlay: OverlayBuilder, ctx: ToolContext): void;
}

// Options appear in both input and output positions of ITool, so only `any` accepts every concrete tool.
// biome-ignore lint/suspicious/noExplicitAny: required for heterogeneous tool lists
export type AnyTool = ITool<string, any, any, any>;
export type ToolId<T extends readonly AnyTool[]> = T[number]['id'];
type ToolById<T extends readonly AnyTool[], Id> = Extract<T[number], { readonly id: Id }>;
export type ToolOptions<T extends readonly AnyTool[], Id extends ToolId<T>> = ToolById<T, Id>['defaultOptions'];
export type ToolUIState<T extends readonly AnyTool[], Id extends ToolId<T>> =
  ToolById<T, Id> extends { getUIState(): infer U } ? U : never;
export type ToolCommand<T extends readonly AnyTool[], Id extends ToolId<T>> =
  ToolById<T, Id> extends { runCommand(command: infer C extends string, ctx: never): void } ? C : never;

/** The active tool as seen by the UI, discriminated by `id`. */
export type ToolSnapshot<T extends readonly AnyTool[]> = {
  [Id in ToolId<T>]: {
    readonly id: Id;
    readonly options: ToolOptions<T, Id>;
    readonly uiState: ToolUIState<T, Id> | undefined;
  };
}[ToolId<T>];
