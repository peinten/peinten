import type { ColorMixer } from '../domain/brush/color-mixer.ts';
import { presets } from '../domain/brush/presets.ts';
import type { BrushResources } from '../domain/brush/resolve-brush.ts';
import { deserializeDocument } from '../domain/document/serialization.ts';
import { createDocState } from '../domain/document/state.ts';
import type { FilterRegistry } from '../domain/filters/filter.ts';
import { newId } from '../domain/ops/ids.ts';
import type { OperationRegistry } from '../domain/ops/registry.ts';
import type { CreateDocumentOptions, RuntimeSnapshot } from './api.ts';
import { LocalDocument } from './document.ts';
import type { OverlayBuilder } from './overlay.ts';
import type { DocumentCodec } from './ports/encoding.ts';
import type { FrameScheduler, ThumbnailFactory } from './ports/platform.ts';
import type { RenderBackend, ViewBackground } from './ports/renderer.ts';
import type { TextEngine } from './ports/text.ts';
import { preserve } from './preserve.ts';
import type {
  AnyTool,
  PointerInput,
  ToolContext,
  ToolId,
  ToolKeyEvent,
  ToolPointerEvent,
  ToolSnapshot,
} from './tool.ts';
import { LocalView, type ToolHost } from './view.ts';
import { panBy, rotateAt, zoomAt } from './viewport.ts';

const DEFAULT_HISTORY_LIMIT = 100;

export interface RuntimeDeps {
  readonly backend: RenderBackend;
  readonly scheduler: FrameScheduler;
  readonly thumbnails: ThumbnailFactory;
  readonly textEngine: TextEngine;
  readonly codec: DocumentCodec;
  readonly registryHash: string;
  readonly mixer: ColorMixer;
  readonly registry: OperationRegistry;
  readonly filters: FilterRegistry;
  readonly clientId: string;
  readonly onError: (error: unknown) => void;
}

export const DEFAULT_RESOURCES: BrushResources = {
  color: [0.1, 0.1, 0.12],
  brush: presets.find((brush) => brush.name === 'Digital Brush') ?? presets[0]!,
  eraser: false,
  size: null,
  opacity: null,
};

/**
 * The engine on the thread that owns the GPU. Holds tools and resources shared by every view, creates documents
 * and views, and routes view input to the active tool.
 */
export class LocalRuntime<T extends readonly AnyTool[]> implements ToolHost {
  readonly #deps: RuntimeDeps;
  readonly #tools = new Map<string, AnyTool>();
  readonly #options = new Map<string, unknown>();
  readonly #contexts = new WeakMap<LocalView, ToolContext>();
  readonly #listeners = new Set<() => void>();
  #activeId: ToolId<T>;
  #boundView: LocalView | null = null;
  #resources: BrushResources = DEFAULT_RESOURCES;
  #snapshot: RuntimeSnapshot<T>;

  constructor(deps: RuntimeDeps, tools: T) {
    if (tools.length === 0) throw new Error('At least one tool is required');
    this.#deps = deps;
    for (const tool of tools) {
      this.#tools.set(tool.id, tool);
      this.#options.set(tool.id, tool.defaultOptions);
    }
    this.#activeId = tools[0]!.id;
    this.#snapshot = this.#buildSnapshot();
  }

  get clientId(): string {
    return this.#deps.clientId;
  }

  get registry(): string {
    return this.#deps.registryHash;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RuntimeSnapshot<T> => this.#snapshot;

  #buildSnapshot(): RuntimeSnapshot<T> {
    const tool = this.#tools.get(this.#activeId)!;
    return {
      tool: { id: tool.id, options: this.#options.get(tool.id), uiState: tool.getUIState?.() } as ToolSnapshot<T>,
      resources: this.#resources,
    };
  }

  #publish(): void {
    // Tools return a fresh UI state object each time, so unchanged parts are matched by value.
    this.#snapshot = preserve(this.#snapshot, this.#buildSnapshot());
    for (const listener of this.#listeners) listener();
  }

  get #activeTool(): AnyTool {
    return this.#tools.get(this.#activeId)!;
  }

  createDocument(options: CreateDocumentOptions): LocalDocument {
    const state =
      'from' in options
        ? deserializeDocument(this.#deps.codec.decode(options.from), this.#deps.filters)
        : createDocState(Math.round(options.width), Math.round(options.height), newId());
    const { width, height } = state;
    const max = this.#deps.backend.maxDocumentSize;
    if (!(width >= 1 && height >= 1 && width <= max && height <= max)) {
      throw new Error(`Document size must be between 1 and ${max} pixels`);
    }
    const history = options.history ?? true;
    const limit = history === false ? 0 : history === true ? DEFAULT_HISTORY_LIMIT : history.limit;
    return new LocalDocument(state, {
      clientId: this.#deps.clientId,
      registry: this.#deps.registry,
      opContext: {
        mixer: this.#deps.mixer,
        filters: this.#deps.filters,
        filterExecutor: this.#deps.backend.filterExecutor,
      },
      mixer: this.#deps.mixer,
      cache: this.#deps.backend.createDocumentCache(width, height),
      scheduler: this.#deps.scheduler,
      thumbnails: this.#deps.thumbnails,
      textEngine: this.#deps.textEngine,
      codec: this.#deps.codec,
      registryHash: this.#deps.registryHash,
      historyLimit: limit,
      onError: this.#deps.onError,
    });
  }

  createView(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    document: LocalDocument,
    options: { input: boolean; navigation: boolean; background: ViewBackground },
  ): LocalView {
    const surface = this.#deps.backend.createViewSurface(canvas, document.cache);
    return new LocalView(document, surface, {
      host: options.input ? this : null,
      navigation: options.navigation,
      background: options.background,
    });
  }

  setTool(id: ToolId<T>): void {
    if (!this.#tools.has(id)) throw new Error(`Unknown tool: ${id}`);
    if (id === this.#activeId) return;
    this.#unbind();
    this.#activeId = id;
    this.#publish();
  }

  setToolOptions(id: string, options: object): void {
    const tool = this.#tools.get(id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    this.#options.set(id, { ...(this.#options.get(id) as object), ...options });
    const ctx = id === this.#activeId && this.#boundView ? this.#context(this.#boundView) : null;
    tool.setOptions?.(options, ctx);
    this.#publish();
    this.#boundView?.document.requestFrame();
  }

  runToolCommand(id: string, command: string): void {
    const tool = this.#tools.get(id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    const ctx = id === this.#activeId && this.#boundView ? this.#context(this.#boundView) : null;
    tool.runCommand?.(command, ctx);
    this.#publish();
  }

  setResources(resources: Partial<BrushResources>): void {
    this.#resources = { ...this.#resources, ...resources };
    this.#publish();
  }

  #context(view: LocalView): ToolContext {
    let ctx = this.#contexts.get(view);
    if (ctx) return ctx;
    const document = view.document;
    ctx = {
      document: document.toolDocument,
      resources: { get: () => this.#resources, set: (resources) => this.setResources(resources) },
      viewport: {
        get: () => view.viewport,
        set: (viewport) => view.setViewport(viewport),
        get size() {
          return view.size;
        },
        toDocument: (x, y) => view.toDocument(x, y),
        toScreen: (x, y) => view.toScreen(x, y),
        panBy: (dx, dy) => view.setViewport(panBy(view.viewport, view.size, dx, dy)),
        zoomAt: (x, y, factor) => view.setViewport(zoomAt(view.viewport, view.size, x, y, factor)),
        rotateAt: (x, y, radians) => view.setViewport(rotateAt(view.viewport, view.size, x, y, radians)),
      },
      beginStroke: (params) => document.beginStroke(params),
      preview: {
        setWarp: (preview) => document.setWarpPreview(preview),
        setSelectionOffset: (offset) => document.setSelectionOffset(offset),
      },
      requestOverlay: () => document.requestFrame(),
      notifyUIState: () => this.#publish(),
    };
    this.#contexts.set(view, ctx);
    return ctx;
  }

  /** Binds the active tool to `view`, deactivating it on the previous view first. */
  #bind(view: LocalView): ToolContext {
    const ctx = this.#context(view);
    if (this.#boundView !== view) {
      this.#unbind();
      this.#boundView = view;
      this.#activeTool.activate?.(ctx);
    }
    return ctx;
  }

  #unbind(): void {
    const view = this.#boundView;
    if (!view) return;
    this.#activeTool.deactivate?.(this.#context(view));
    this.#boundView = null;
    view.document.requestFrame();
  }

  pointer(view: LocalView, kind: PointerInput['kind'], event: ToolPointerEvent): void {
    const tool = this.#activeTool;
    const ctx = this.#bind(view);
    if (kind === 'down') tool.onPointerDown?.(event, ctx);
    else if (kind === 'move') tool.onPointerMove?.(event, ctx);
    else if (kind === 'up') tool.onPointerUp?.(event, ctx);
    else tool.onPointerCancel?.(ctx);
  }

  key(view: LocalView, kind: 'down' | 'up', event: ToolKeyEvent): void {
    const tool = this.#activeTool;
    const ctx = this.#bind(view);
    if (kind === 'down') tool.onKeyDown?.(event, ctx);
    else tool.onKeyUp?.(event, ctx);
  }

  overlay(view: LocalView, builder: OverlayBuilder): void {
    if (this.#boundView !== view) return;
    this.#activeTool.drawOverlay?.(builder, this.#context(view));
  }

  detach(view: LocalView): void {
    if (this.#boundView === view) this.#unbind();
  }

  dispose(): void {
    this.#unbind();
    this.#deps.backend.dispose();
  }
}
