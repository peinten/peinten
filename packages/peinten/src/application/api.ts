import type { BrushResources } from '../domain/brush/resolve-brush.ts';
import type { NodeId } from '../domain/document/nodes.ts';
import type { FilterSpec } from '../domain/filters/filter.ts';
import type { OperationDraft } from '../domain/ops/operation.ts';
import type { Presence } from './collab/protocol.ts';
import type { Exporter } from './export.ts';
import type { CollabTransport } from './ports/collab.ts';
import type { ViewBackground } from './ports/renderer.ts';
import type { DocumentSnapshot } from './snapshot.ts';
import type { AnyTool, ToolCommand, ToolId, ToolOptions, ToolSnapshot } from './tool.ts';
import type { ViewSnapshot } from './view.ts';
import type { Viewport } from './viewport.ts';

export interface RuntimeSnapshot<T extends readonly AnyTool[]> {
  readonly tool: ToolSnapshot<T>;
  readonly resources: BrushResources;
}

/** A blank document of the given size, or one opened from bytes produced by `PaintDocument.serialize`. */
export type CreateDocumentOptions = (
  | { readonly width: number; readonly height: number }
  | { readonly from: Uint8Array }
) & {
  /** Undo history. `false` keeps none, which suits throwaway documents such as brush previews. */
  readonly history?: boolean | { readonly limit: number };
};

export interface CreateViewOptions {
  readonly canvas: HTMLCanvasElement;
  readonly document: PaintDocument;
  /** Capture pointer, key and wheel input. `navigation: false` keeps tools but disables built-in pan and zoom. */
  readonly input?: boolean | { readonly navigation?: boolean };
  readonly background?: ViewBackground;
}

/**
 * The synchronous state channel shared by runtimes, documents and views. Snapshots are immutable and keep the identity
 * of unchanged parts, so UI bindings can select slices without extra memoization.
 */
export interface SnapshotSource<S> {
  /** Returns an unsubscribe function. `this` is not needed, so the method can be passed around detached. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): S;
}

/** Entry point of the engine. The main-thread and the worker implementations share this interface. */
export interface PaintRuntime<T extends readonly AnyTool[] = readonly AnyTool[]>
  extends SnapshotSource<RuntimeSnapshot<T>> {
  /** Hash of operations, filters and the color mixer. A collaboration `Sequencer` admits only matching clients. */
  readonly registry: string;
  createDocument(options: CreateDocumentOptions): Promise<PaintDocument>;
  createView(options: CreateViewOptions): Promise<PaintView>;
  setTool(id: ToolId<T>): Promise<void>;
  setToolOptions<Id extends ToolId<T>>(id: Id, options: Partial<ToolOptions<T, Id>>): Promise<void>;
  /** Sends a one-shot command to a tool, e.g. `runToolCommand('transform', 'commit')`. */
  runToolCommand<Id extends ToolId<T>>(id: Id, command: ToolCommand<T, Id>): Promise<void>;
  setResources(resources: Partial<BrushResources>): Promise<void>;
  dispose(): Promise<void>;
}

export interface PaintDocument extends SnapshotSource<DocumentSnapshot> {
  /** Applies operation drafts. An array is applied atomically and undone as one step. */
  dispatch(op: OperationDraft | readonly OperationDraft[]): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  setActiveNode(id: NodeId | null): Promise<void>;
  setQuickMask(enabled: boolean): Promise<void>;
  setFilterPreview(preview: { readonly nodeId: NodeId; readonly filter: FilterSpec } | null): Promise<void>;
  /** The document as a `.peinten` file. History and selections are not included. */
  serialize(): Promise<Uint8Array>;
  /**
   * Renders the document, without previews or an unfinished stroke, and turns it into a file with `exporter`.
   * Edits wait until the exporter finishes. In the worker build the exporter runs on the main thread and reads the
   * document from the worker.
   */
  export(exporter: Exporter): Promise<Blob>;
  readonly collab: {
    /** Joins a room. In the worker build the transport stays on the main thread and messages are relayed. */
    connect(transport: CollabTransport): Promise<void>;
    disconnect(): Promise<void>;
    /** Name and color shown to others. The cursor follows this client's pointer automatically. */
    setPresence(presence: Pick<Presence, 'name' | 'color'> | null): Promise<void>;
  };
  dispose(): Promise<void>;
}

export interface PaintView extends SnapshotSource<ViewSnapshot> {
  setViewport(viewport: Partial<Viewport>): Promise<void>;
  dispose(): Promise<void>;
}
