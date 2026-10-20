import type { ColorMixer } from '../domain/brush/color-mixer.ts';
import type { BrushSettings } from '../domain/brush/settings.ts';
import type { StrokeSample } from '../domain/brush/stroke-samples.ts';
import type { ClientId, NodeId, TextLayer } from '../domain/document/nodes.ts';
import { deserializeDocument, serializeDocument } from '../domain/document/serialization.ts';
import { type DocState, MAX_DOCUMENT_SIZE, walkNodes } from '../domain/document/state.ts';
import type { FilterSpec } from '../domain/filters/filter.ts';
import { type Batch, Timeline } from '../domain/history/timeline.ts';
import type { BatchId } from '../domain/history/toggle.ts';
import type { OpContext, PrepareContext, TextRasterizer } from '../domain/ops/context.ts';
import { newId } from '../domain/ops/ids.ts';
import type { Operation, OperationDraft } from '../domain/ops/operation.ts';
import type { OperationRegistry } from '../domain/ops/registry.ts';
import type { StrokeTarget } from '../domain/ops/stroke-renderer.ts';
import { rgba8ToTiles } from '../domain/raster/pixels.ts';
import { renderThumbnail } from '../domain/raster/thumbnail.ts';
import type { TextLayerData } from '../domain/text/text-layer.ts';
import type { TileMap } from '../domain/tiles/tile-map.ts';
import { ApplyQueue } from './apply-queue.ts';
import type { Presence } from './collab/protocol.ts';
import { CollabSession, type CollabState, OFFLINE } from './collab/session.ts';
import { createExportSource, type ExportSource } from './export.ts';
import { PeerStrokes } from './peer-strokes.ts';
import type { CollabTransport } from './ports/collab.ts';
import type { DocumentCodec } from './ports/encoding.ts';
import type { FrameScheduler, ThumbnailFactory } from './ports/platform.ts';
import type { DocumentRenderCache, RenderSource, WarpPreview } from './ports/renderer.ts';
import type { TextEngine } from './ports/text.ts';
import { type DocumentSnapshot, SnapshotBuilder, type Thumbnail } from './snapshot.ts';
import { StrokeSession } from './stroke-session.ts';
import type { StrokeHandle, ToolDocument } from './tool.ts';

const THUMBNAIL_SIZE = 64;
const THUMBNAIL_INTERVAL_MS = 400;

export interface DocumentDeps {
  readonly clientId: ClientId;
  readonly registry: OperationRegistry;
  readonly opContext: OpContext;
  readonly mixer: ColorMixer;
  readonly cache: DocumentRenderCache;
  readonly scheduler: FrameScheduler;
  readonly thumbnails: ThumbnailFactory;
  readonly textEngine: TextEngine;
  readonly codec: DocumentCodec;
  /** Hash of operations, filters and the color mixer; collaborators must match. */
  readonly registryHash: string;
  /** Undoable batches kept; 0 disables history. */
  readonly historyLimit: number;
  readonly onError: (error: unknown) => void;
}

/** Something drawn by the document's frame loop, i.e. a view. */
export interface FrameListener {
  /** Returns true to request another frame, for animations such as marching ants. */
  frame(time: number): boolean;
}

/**
 * One open document. Owns the timeline, the apply queue, the live stroke, text rasters, thumbnails and
 * the GPU caches, so several documents (a canvas and a brush preview) never share state.
 */
export class LocalDocument {
  readonly #deps: DocumentDeps;
  readonly #timeline: Timeline;
  readonly #queue = new ApplyQueue();
  readonly #snapshots = new SnapshotBuilder();
  readonly #listeners = new Set<() => void>();
  readonly #frameListeners = new Set<FrameListener>();
  #snapshot: DocumentSnapshot;
  #activeNodeId: NodeId | null;
  #quickMask = false;
  #filterPreview: { nodeId: NodeId; filter: FilterSpec } | null = null;
  #warpPreview: WarpPreview | null = null;
  #selectionOffset: RenderSource['selectionOffset'] = null;
  #stroke: StrokeSession | null = null;
  readonly #peerStrokes: PeerStrokes;
  #cancelStroke: (() => void) | null = null;
  #undoStack: BatchId[] = [];
  #collab: CollabSession | null = null;
  #redoStack: BatchId[] = [];
  #frameRequested = false;
  #disposed = false;
  readonly #textRasters = new Map<NodeId, { text: TextLayerData; tiles: TileMap }>();
  readonly #textPending = new Map<NodeId, TextLayerData>();
  readonly #thumbnails = new Map<NodeId, Thumbnail>();
  readonly #thumbnailSources = new Map<NodeId, { source: unknown; time: number }>();
  #thumbnailVersion = 0;
  #thumbnailsInFlight = 0;

  constructor(initial: DocState, deps: DocumentDeps) {
    this.#deps = deps;
    this.#timeline = new Timeline(initial, {
      apply: (state, op) => deps.registry.get(op.type).apply(state, op, deps.opContext),
      limit: deps.historyLimit,
      onSkip: (batch, error) => deps.onError(new Error(`Batch ${batch.id} was skipped: ${(error as Error).message}`)),
    });
    this.#activeNodeId = initial.rootIds.at(-1) ?? null;
    this.#peerStrokes = new PeerStrokes({
      mixer: deps.mixer,
      changed: () => this.#requestFrame(),
      run: (task) => void this.#queue.run(task),
    });
    const doc = this;
    this.toolDocument = {
      get state() {
        return doc.#timeline.state;
      },
      get clientId() {
        return doc.clientId;
      },
      get activeNodeId() {
        return doc.#activeNodeId;
      },
      get quickMask() {
        return doc.#quickMask;
      },
      get selection() {
        return doc.#timeline.state.selections.get(doc.clientId) ?? null;
      },
      textRaster: (layer) => doc.#textRasters.get(layer.id)?.tiles,
      submit: (drafts) => doc.dispatch(drafts),
      setActiveNode: (id) => doc.setActiveNode(id),
    };
    this.#snapshot = this.#buildSnapshot();
    this.#requestFrame();
  }

  get clientId(): ClientId {
    return this.#deps.clientId;
  }

  get state(): DocState {
    return this.#timeline.state;
  }

  get width(): number {
    return this.#timeline.state.width;
  }

  get height(): number {
    return this.#timeline.state.height;
  }

  get cache(): DocumentRenderCache {
    return this.#deps.cache;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): DocumentSnapshot => this.#snapshot;

  /** Applies drafts as one atomic, undoable batch. */
  dispatch(input: OperationDraft | readonly OperationDraft[]): Promise<void> {
    return this.#queue.run(() => this.#submit(Array.isArray(input) ? input : [input as OperationDraft], true));
  }

  async #submit(drafts: readonly OperationDraft[], recordUndo: boolean, precomputed?: DocState): Promise<void> {
    const prepareContext: PrepareContext = {
      state: this.#timeline.state,
      clientId: this.clientId,
      text: this.#textRasterizer,
    };
    const prepared = await Promise.all(
      drafts.map((draft) => this.#deps.registry.get(draft.type).prepare?.(draft as never, prepareContext) ?? draft),
    );
    const batch: Batch = {
      id: newId(),
      clientId: this.clientId,
      ops: prepared.map((draft) => ({ ...draft, id: newId(), clientId: this.clientId }) as Operation),
    };
    await this.#timeline.local(batch, precomputed);
    if (this.#collab) this.#collab.submit(batch);
    else await this.#timeline.commit(batch);
    if (recordUndo && this.#deps.historyLimit > 0) {
      this.#undoStack.push(batch.id);
      this.#redoStack = [];
    }
    this.#afterChange();
  }

  #afterChange(): void {
    const active = this.#activeNodeId;
    if (active !== null && !this.#timeline.state.nodes.has(active))
      this.#activeNodeId = this.#timeline.state.rootIds.at(-1) ?? null;
    this.#requestFrame();
  }

  undo(): Promise<void> {
    if (this.#cancelStroke) {
      this.#cancelStroke();
      return Promise.resolve();
    }
    return this.#queue.run(async () => {
      while (this.#undoStack.length) {
        const id = this.#undoStack.pop()!;
        if (!this.#timeline.has(id) || !this.#timeline.isEnabled(id)) continue;
        await this.#submit([{ type: 'set-op-enabled', batchId: id, enabled: false } as OperationDraft], false);
        this.#redoStack.push(id);
        return;
      }
    });
  }

  redo(): Promise<void> {
    return this.#queue.run(async () => {
      while (this.#redoStack.length) {
        const id = this.#redoStack.pop()!;
        if (!this.#timeline.has(id)) continue;
        await this.#submit([{ type: 'set-op-enabled', batchId: id, enabled: true } as OperationDraft], false);
        this.#undoStack.push(id);
        return;
      }
    });
  }

  get #canUndo(): boolean {
    return (
      this.#cancelStroke !== null ||
      this.#undoStack.some((id) => this.#timeline.has(id) && this.#timeline.isEnabled(id))
    );
  }

  get #canRedo(): boolean {
    return this.#redoStack.some((id) => this.#timeline.has(id));
  }

  setActiveNode(id: NodeId | null): void {
    if (id !== null && !this.#timeline.state.nodes.has(id)) throw new Error(`Unknown node: ${id}`);
    this.#activeNodeId = id;
    this.#requestFrame();
  }

  setQuickMask(enabled: boolean): void {
    this.#quickMask = enabled;
    this.#requestFrame();
  }

  setFilterPreview(preview: { nodeId: NodeId; filter: FilterSpec } | null): void {
    this.#filterPreview = preview
      ? { nodeId: preview.nodeId, filter: this.#deps.opContext.filters.parse(preview.filter) }
      : null;
    this.#requestFrame();
  }

  setSelectionOffset(offset: RenderSource['selectionOffset']): void {
    this.#selectionOffset = offset;
    this.#requestFrame();
  }

  setWarpPreview(preview: WarpPreview | null): void {
    this.#warpPreview = preview;
    this.#requestFrame();
  }

  /** Starts a live stroke. Returns null when there is nothing paintable to draw on. */
  beginStroke(params: {
    readonly brush: BrushSettings;
    readonly target?: StrokeTarget;
    readonly seed?: number;
  }): StrokeHandle | null {
    const target = params.target ?? this.#defaultStrokeTarget();
    if (!target) return null;
    if ('nodeId' in target) {
      const node = this.#timeline.state.nodes.get(target.nodeId);
      if (node?.kind !== 'paint' || node.locked) return null;
    }
    const seed = params.seed ?? Math.floor(Math.random() * 0x7fffffff);
    const buffered: StrokeSample[] = [];
    let session: StrokeSession | null = null;
    let finish: (outcome: 'end' | 'cancel') => void = () => {};
    const outcome = new Promise<'end' | 'cancel'>((resolve) => {
      finish = resolve;
    });
    this.#cancelStroke = () => finish('cancel');
    const task = this.#queue.run(async () => {
      try {
        session = new StrokeSession(
          this.#timeline.state,
          { target, brush: params.brush, seed, clientId: this.clientId },
          this.#deps.mixer,
        );
      } catch (error) {
        this.#cancelStroke = null;
        this.#deps.onError(error);
        return;
      }
      if ('nodeId' in target) this.#collab?.beginStroke({ seed, nodeId: target.nodeId, brush: params.brush });
      for (const sample of buffered) this.#addStrokeSample(session, sample);
      this.#stroke = session;
      this.#requestFrame();
      const result = await outcome;
      this.#stroke = null;
      this.#cancelStroke = null;
      this.#collab?.endStroke(result === 'cancel');
      if (result === 'cancel') {
        this.#requestFrame();
        return;
      }
      const { state, draft } = session.finish();
      await this.#submit([draft], true, state);
    });
    return {
      addSample: (sample) => {
        if (session) {
          this.#addStrokeSample(session, sample);
          this.#requestFrame();
        } else {
          buffered.push(sample);
        }
      },
      end: () => {
        finish('end');
        return task.catch((error) => this.#deps.onError(error));
      },
      cancel: () => finish('cancel'),
    };
  }

  #addStrokeSample(session: StrokeSession, sample: StrokeSample): void {
    const quantized = session.addSample(sample);
    this.#collab?.addStrokeSample(quantized);
  }

  #defaultStrokeTarget(): StrokeTarget | null {
    if (this.#quickMask) return { selection: true };
    return this.#activeNodeId ? { nodeId: this.#activeNodeId } : null;
  }

  /** Tool-facing view of the document. */
  readonly toolDocument: ToolDocument;

  readonly #textRasterizer: TextRasterizer = {
    rasterize: async (layer: TextLayer) => {
      const image = await this.#renderText(layer.text);
      return image ?? new Map();
    },
  };

  async #renderText(text: TextLayerData): Promise<TileMap | null> {
    const engine = this.#deps.textEngine;
    const layout = await engine.layout(text);
    const image = engine.rasterize(text, layout, text.transform);
    return image ? rgba8ToTiles(image.data, image.width, image.height, image.x, image.y) : null;
  }

  /** Rasterizes text layers whose content changed since their last render. */
  #syncTextRasters(state: DocState): void {
    for (const node of state.nodes.values()) {
      if (node.kind !== 'text') continue;
      const cached = this.#textRasters.get(node.id);
      if (cached?.text === node.text || this.#textPending.get(node.id) === node.text) continue;
      this.#textPending.set(node.id, node.text);
      this.#renderText(node.text)
        .then((tiles) => {
          if (this.#textPending.get(node.id) !== node.text) return;
          this.#textPending.delete(node.id);
          this.#textRasters.set(node.id, { text: node.text, tiles: tiles ?? new Map() });
          this.#requestFrame();
        })
        .catch(this.#deps.onError);
    }
    for (const id of this.#textRasters.keys()) if (!state.nodes.has(id)) this.#textRasters.delete(id);
  }

  /** Regenerates thumbnails of layers whose pixels changed, at most every few hundred milliseconds. */
  #syncThumbnails(state: DocState, time: number): void {
    if (this.#thumbnailsInFlight > 0) return;
    walkNodes(state, (node) => {
      if (node.kind !== 'paint' && node.kind !== 'text') return;
      const live =
        this.#stroke && 'nodeId' in this.#stroke.params.target && this.#stroke.params.target.nodeId === node.id;
      const tiles = node.kind === 'paint' ? node.tiles : this.#textRasters.get(node.id)?.tiles;
      if (!tiles) return;
      const source = live ? this.#stroke : tiles;
      const known = this.#thumbnailSources.get(node.id);
      if (known && known.source === source && !live) return;
      if (known && time - known.time < THUMBNAIL_INTERVAL_MS) {
        this.#requestFrame();
        return;
      }
      this.#thumbnailSources.set(node.id, { source, time });
      const pixels = live ? new Map([...tiles, ...this.#stroke!.workingTiles]) : tiles;
      const image = renderThumbnail(pixels, state.width, state.height, THUMBNAIL_SIZE);
      this.#thumbnailsInFlight++;
      this.#deps.thumbnails
        .create(image.data, image.width, image.height)
        .then((bitmap) => {
          this.#thumbnails.get(node.id)?.bitmap.close();
          this.#thumbnails.set(node.id, { version: ++this.#thumbnailVersion, bitmap });
        })
        .catch(this.#deps.onError)
        .finally(() => {
          this.#thumbnailsInFlight--;
          this.#requestFrame();
        });
    });
    for (const id of this.#thumbnails.keys()) {
      if (state.nodes.has(id)) continue;
      this.#thumbnails.get(id)!.bitmap.close();
      this.#thumbnails.delete(id);
      this.#thumbnailSources.delete(id);
    }
  }

  /** Joins a collaboration room. Local edits stay pending until the sequencer confirms them. */
  connect(transport: CollabTransport): void {
    this.#collab?.close();
    this.#collab = new CollabSession(transport, {
      clientId: this.clientId,
      registry: this.#deps.registryHash,
      run: (task) => this.#queue.run(task),
      commit: async (batch) => {
        const applied = await this.#timeline.commit(batch);
        this.#peerStrokes.committed(batch);
        this.#afterChange();
        return applied;
      },
      reject: async (batchId) => {
        await this.#timeline.reject(batchId);
        this.#afterChange();
      },
      reset: async (data) => {
        const state = deserializeDocument(this.#deps.codec.decode(data), this.#deps.opContext.filters);
        // The room's size wins; the GPU cache follows it on the next frame. Files may be larger than peinten renders.
        if (state.width > MAX_DOCUMENT_SIZE || state.height > MAX_DOCUMENT_SIZE)
          throw new Error(
            `The shared document is ${state.width}×${state.height}, more than ${MAX_DOCUMENT_SIZE} pixels`,
          );
        await this.#timeline.reset(state);
        this.#afterChange();
      },
      pending: () => this.#timeline.pending(),
      snapshot: () => this.#deps.codec.encode(serializeDocument(this.#timeline.confirmedState, { selections: true })),
      parse: (op) => this.#deps.registry.parse(op),
      previewStroke: (clientId, progress) => this.#peerStrokes.receive(clientId, progress),
      clearStrokePreviews: () => this.#peerStrokes.clear(),
      changed: () => this.#requestFrame(),
      onError: (error) => this.#deps.onError(error),
    });
    this.#requestFrame();
  }

  /** Leaves the room and keeps working alone; unconfirmed edits are kept as local history. */
  disconnect(): Promise<void> {
    const session = this.#collab;
    if (!session) return Promise.resolve();
    session.close();
    this.#collab = null;
    this.#requestFrame();
    return this.#queue.run(async () => {
      for (const batch of this.#timeline.pending()) await this.#timeline.commit(batch);
      this.#afterChange();
    });
  }

  setPresence(presence: Pick<Presence, 'name' | 'color'> | null): void {
    this.#collab?.setPresence(presence);
  }

  /** Called by views with the pointer position in document pixels. */
  setCursor(cursor: Presence['cursor']): void {
    this.#collab?.setCursor(cursor);
  }

  get #collabState(): CollabState {
    return this.#collab?.state ?? OFFLINE;
  }

  serialize(): Promise<Uint8Array> {
    return this.#queue.run(() =>
      this.#deps.codec.encode(serializeDocument(this.#timeline.state, { selections: false })),
    );
  }

  /**
   * Renders the document without previews and lets `use` read it, typically an exporter. Edits wait in the queue
   * until `use` settles, so every read sees the same state.
   */
  export<R>(use: (source: ExportSource) => Promise<R>): Promise<R> {
    return this.#queue.run(async () => {
      const state = this.#timeline.state;
      const textRasters = await this.#currentTextRasters(state);
      const cache = this.#deps.cache;
      cache.sync(
        {
          state,
          live: [],
          textRasters,
          selection: null,
          liveSelection: null,
          quickMask: false,
          selectionOffset: null,
          warpPreview: null,
          filterPreview: null,
        },
        { liveKeys: new Map(), liveSelectionKeys: [] },
      );
      try {
        return await use(
          createExportSource({
            state,
            readComposite: () => cache.readComposite(),
            readGroup: (id: NodeId) => cache.readGroup(id),
            textRaster: (id: NodeId) => textRasters.get(id),
          }),
        );
      } finally {
        // Restore previews and live tiles on screen.
        this.#requestFrame();
      }
    });
  }

  /** Text rasters matching `state`, rendering any that the frame loop has not caught up with yet. */
  async #currentTextRasters(state: DocState): Promise<Map<NodeId, TileMap>> {
    const rasters = new Map<NodeId, TileMap>();
    for (const node of state.nodes.values()) {
      if (node.kind !== 'text') continue;
      const cached = this.#textRasters.get(node.id);
      rasters.set(
        node.id,
        cached?.text === node.text ? cached.tiles : ((await this.#renderText(node.text)) ?? new Map()),
      );
    }
    return rasters;
  }

  addFrameListener(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);
    this.#requestFrame();
    return () => this.#frameListeners.delete(listener);
  }

  /** Schedules one frame: sync GPU caches, draw views, publish the snapshot. */
  requestFrame(): void {
    this.#requestFrame();
  }

  #requestFrame(): void {
    if (this.#frameRequested || this.#disposed) return;
    this.#frameRequested = true;
    this.#deps.scheduler.request((time) => {
      this.#frameRequested = false;
      if (!this.#disposed) this.#frame(time);
    });
  }

  #frame(time: number): void {
    const state = this.#timeline.state;
    this.#syncTextRasters(state);
    const stroke = this.#stroke;
    const target = stroke?.params.target;
    const dirty = stroke ? stroke.takeDirty() : [];
    const selection = state.selections.get(this.clientId) ?? null;
    const peers = this.#peerStrokes.frame(state);
    const ownLive =
      stroke && target && 'nodeId' in target ? [{ nodeId: target.nodeId, tiles: stroke.workingTiles }] : [];
    const source: RenderSource = {
      state,
      live: [...ownLive, ...peers.live],
      textRasters: new Map([...this.#textRasters].map(([id, entry]) => [id, entry.tiles])),
      selection,
      liveSelection: stroke && target && 'selection' in target ? stroke.workingTiles : null,
      quickMask: this.#quickMask,
      selectionOffset: this.#selectionOffset,
      warpPreview: this.#warpPreview,
      filterPreview: this.#filterPreview,
    };
    const isSelectionStroke = target !== undefined && 'selection' in target;
    if (target && 'nodeId' in target)
      peers.dirty.set(target.nodeId, [...(peers.dirty.get(target.nodeId) ?? []), ...dirty]);
    this.#deps.cache.sync(source, { liveKeys: peers.dirty, liveSelectionKeys: isSelectionStroke ? dirty : [] });
    let again = false;
    for (const listener of this.#frameListeners) again = listener.frame(time) || again;
    this.#syncThumbnails(state, time);
    const snapshot = this.#buildSnapshot();
    if (snapshot !== this.#snapshot) {
      this.#snapshot = snapshot;
      for (const listener of this.#listeners) listener();
    }
    if (again) this.#requestFrame();
  }

  #buildSnapshot(): DocumentSnapshot {
    return this.#snapshots.build({
      state: this.#timeline.state,
      clientId: this.clientId,
      activeNodeId: this.#activeNodeId,
      quickMask: this.#quickMask,
      canUndo: this.#canUndo,
      canRedo: this.#canRedo,
      thumbnails: this.#thumbnails,
      filterPreview: this.#filterPreview,
      collab: this.#collabState,
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#collab?.close();
    this.#cancelStroke?.();
    for (const thumbnail of this.#thumbnails.values()) thumbnail.bitmap.close();
    this.#deps.cache.dispose();
  }
}
