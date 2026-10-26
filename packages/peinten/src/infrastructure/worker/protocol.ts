import type { CreateDocumentOptions, RuntimeSnapshot } from '../../application/api.ts';
import type { Presence } from '../../application/collab/protocol.ts';
import type { ExportLayer, RasterImage } from '../../application/export.ts';
import type { OverlayShape } from '../../application/overlay.ts';
import type { ViewBackground } from '../../application/ports/renderer.ts';
import type { DocumentSnapshot } from '../../application/snapshot.ts';
import type { AnyTool, PointerInput, ToolKeyEvent } from '../../application/tool.ts';
import type { ViewSnapshot, WheelInput } from '../../application/view.ts';
import type { CanvasSize, Viewport } from '../../application/viewport.ts';
import type { BrushResources } from '../../domain/brush/resolve-brush.ts';
import type { NodeId } from '../../domain/document/nodes.ts';
import type { FilterSpec } from '../../domain/filters/filter.ts';
import type { OperationDraft } from '../../domain/ops/operation.ts';

/** A canvas handed to the worker. The OffscreenCanvas is transferred once; later views reuse it by id. */
export interface CanvasHandle {
  readonly id: number;
  readonly canvas?: OffscreenCanvas;
}

/** Methods the worker exposes through comlink. Listener arguments arrive as comlink proxies. */
export interface WorkerApi {
  /** Returns the runtime's registry hash. */
  init(options: { clientId?: string }): Promise<string>;
  subscribeRuntime(listener: (snapshot: RuntimeSnapshot<readonly AnyTool[]>) => void): void;
  setTool(id: string): void;
  setToolOptions(id: string, options: object): void;
  runToolCommand(id: string, command: string): void;
  setResources(resources: Partial<BrushResources>): void;
  createDocument(options: CreateDocumentOptions): number;
  subscribeDocument(id: number, listener: (snapshot: DocumentSnapshot) => void): void;
  dispatch(id: number, drafts: readonly OperationDraft[]): Promise<void>;
  undo(id: number): Promise<void>;
  redo(id: number): Promise<void>;
  setActiveNode(id: number, nodeId: NodeId | null): void;
  setQuickMask(id: number, enabled: boolean): void;
  setEditingMask(id: number, enabled: boolean): void;
  setFilterPreview(id: number, preview: { nodeId: NodeId; filter: FilterSpec } | null): void;
  serialize(id: number): Promise<Uint8Array>;
  /** Holds the document unchanged for an exporter on the main thread until `endExport`. */
  beginExport(id: number): Promise<{ session: number; width: number; height: number }>;
  exportComposite(session: number): Promise<RasterImage>;
  exportLayers(session: number): Promise<readonly ExportLayer[]>;
  endExport(session: number): void;
  collabConnect(id: number, port: MessagePort): void;
  collabDisconnect(id: number): Promise<void>;
  setPresence(id: number, presence: Pick<Presence, 'name' | 'color'> | null): void;
  disposeDocument(id: number): void;
  createView(
    documentId: number,
    canvas: CanvasHandle,
    options: { input: boolean; navigation: boolean; background: ViewBackground },
  ): number;
  subscribeView(id: number, listener: (snapshot: ViewSnapshot) => void): void;
  viewPointer(id: number, inputs: PointerInput[]): void;
  viewKey(id: number, kind: 'down' | 'up', event: ToolKeyEvent): void;
  viewWheel(id: number, input: WheelInput): void;
  viewResize(id: number, size: CanvasSize): void;
  setViewport(id: number, viewport: Partial<Viewport>): void;
  setViewOverlay(id: number, shapes: readonly OverlayShape[]): void;
  disposeView(id: number): void;
  dispose(): void;
}
