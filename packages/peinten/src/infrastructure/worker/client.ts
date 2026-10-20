import * as Comlink from 'comlink';
import type {
  CreateDocumentOptions,
  CreateViewOptions,
  PaintDocument,
  PaintRuntime,
  PaintView,
  RuntimeSnapshot,
} from '../../application/api.ts';
import { preserve } from '../../application/preserve.ts';
import type { DocumentSnapshot } from '../../application/snapshot.ts';
import type { AnyTool, ToolCommand, ToolId, ToolOptions } from '../../application/tool.ts';
import type { ViewSnapshot } from '../../application/view.ts';
import type { BrushResources } from '../../domain/brush/resolve-brush.ts';
import { captureInput } from '../input/capture.ts';
import { relayTransport } from './collab-relay.ts';
import type { WorkerApi } from './protocol.ts';

/** Caches the latest snapshot pushed by the worker so `getSnapshot` can stay synchronous. */
class SnapshotMirror<S> {
  #snapshot: S | undefined;
  readonly #listeners = new Set<() => void>();
  readonly ready: Promise<void>;
  #resolveReady: () => void = () => {};

  constructor() {
    this.ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  receive = (snapshot: S): void => {
    this.#snapshot = this.#snapshot === undefined ? snapshot : preserve(this.#snapshot, snapshot);
    this.#resolveReady();
    for (const listener of this.#listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): S => {
    if (this.#snapshot === undefined) throw new Error('Snapshot not received yet');
    return this.#snapshot;
  };
}

const canvasIds = new WeakMap<HTMLCanvasElement, number>();
let nextCanvasId = 1;
const remoteDocuments = new WeakMap<PaintDocument, number>();

/**
 * Main-thread side of a runtime that lives in a worker. Implements the same PaintRuntime interface as the
 * main-thread runtime; canvases are transferred to the worker and input is forwarded to it.
 */
export async function connectRuntime<T extends readonly AnyTool[]>(
  worker: Worker,
  options: { clientId?: string } = {},
): Promise<PaintRuntime<T>> {
  const api = Comlink.wrap<WorkerApi>(worker);
  const registry = await api.init(options);
  const runtimeMirror = new SnapshotMirror<RuntimeSnapshot<T>>();
  await api.subscribeRuntime(Comlink.proxy(runtimeMirror.receive as never));
  await runtimeMirror.ready;

  return {
    registry,
    subscribe: runtimeMirror.subscribe,
    getSnapshot: runtimeMirror.getSnapshot,
    async createDocument(createOptions: CreateDocumentOptions): Promise<PaintDocument> {
      const id = await api.createDocument(createOptions);
      const mirror = new SnapshotMirror<DocumentSnapshot>();
      await api.subscribeDocument(id, Comlink.proxy(mirror.receive));
      await mirror.ready;
      const document: PaintDocument = {
        dispatch: (op) => api.dispatch(id, Array.isArray(op) ? op : [op]),
        undo: () => api.undo(id),
        redo: () => api.redo(id),
        setActiveNode: (nodeId) => api.setActiveNode(id, nodeId),
        setQuickMask: (enabled) => api.setQuickMask(id, enabled),
        setFilterPreview: (preview) => api.setFilterPreview(id, preview),
        serialize: () => api.serialize(id),
        async export(exporter) {
          const { session, width, height } = await api.beginExport(id);
          try {
            return await exporter({
              width,
              height,
              composite: () => api.exportComposite(session),
              layers: () => api.exportLayers(session),
            });
          } finally {
            void api.endExport(session);
          }
        },
        collab: {
          connect: (transport) => {
            const port = relayTransport(transport);
            return api.collabConnect(id, Comlink.transfer(port, [port]));
          },
          disconnect: () => api.collabDisconnect(id),
          setPresence: (presence) => api.setPresence(id, presence),
        },
        subscribe: mirror.subscribe,
        getSnapshot: mirror.getSnapshot,
        dispose: () => api.disposeDocument(id),
      };
      remoteDocuments.set(document, id);
      return document;
    },
    async createView(viewOptions: CreateViewOptions): Promise<PaintView> {
      const documentId = remoteDocuments.get(viewOptions.document);
      if (documentId === undefined) throw new Error('The document does not belong to this runtime');
      // transferControlToOffscreen works once per element (React StrictMode creates views twice), so the
      // transferred canvas stays in the worker and later views refer to it by id.
      let canvasId = canvasIds.get(viewOptions.canvas);
      let handle: { id: number; canvas?: OffscreenCanvas };
      if (canvasId === undefined) {
        canvasId = nextCanvasId++;
        canvasIds.set(viewOptions.canvas, canvasId);
        const offscreen = viewOptions.canvas.transferControlToOffscreen();
        handle = Comlink.transfer({ id: canvasId, canvas: offscreen }, [offscreen]);
      } else {
        handle = { id: canvasId };
      }
      const input = viewOptions.input ?? true;
      const id = await api.createView(documentId, handle, {
        input: input !== false,
        navigation: input !== false && (input === true || input.navigation !== false),
        background: viewOptions.background ?? 'checker',
      });
      const mirror = new SnapshotMirror<ViewSnapshot>();
      await api.subscribeView(id, Comlink.proxy(mirror.receive));
      await mirror.ready;
      const release = captureInput(
        viewOptions.canvas,
        {
          pointer: (inputs) => void api.viewPointer(id, inputs),
          key: (kind, event) => void api.viewKey(id, kind, event),
          wheel: (wheel) => void api.viewWheel(id, wheel),
          resize: (size) => void api.viewResize(id, size),
        },
        input !== false,
      );
      return {
        setViewport: (viewport) => api.setViewport(id, viewport),
        setOverlay: (shapes) => api.setViewOverlay(id, shapes),
        subscribe: mirror.subscribe,
        getSnapshot: mirror.getSnapshot,
        dispose: async () => {
          release();
          await api.disposeView(id);
        },
      };
    },
    setTool: (id: ToolId<T>) => api.setTool(id),
    setToolOptions: <Id extends ToolId<T>>(id: Id, toolOptions: Partial<ToolOptions<T, Id>>) =>
      api.setToolOptions(id, toolOptions as object),
    runToolCommand: <Id extends ToolId<T>>(id: Id, command: ToolCommand<T, Id>) => api.runToolCommand(id, command),
    setResources: (resources: Partial<BrushResources>) => api.setResources(resources),
    async dispose() {
      await api.dispose();
      api[Comlink.releaseProxy]();
      worker.terminate();
    },
  };
}
