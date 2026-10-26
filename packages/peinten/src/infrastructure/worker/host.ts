import * as Comlink from 'comlink';
import type { LocalDocument } from '../../application/document.ts';
import type { ExportSource } from '../../application/export.ts';
import type { LocalRuntime } from '../../application/runtime.ts';
import type { AnyTool } from '../../application/tool.ts';
import type { LocalView } from '../../application/view.ts';
import { portTransport } from './collab-relay.ts';
import type { WorkerApi } from './protocol.ts';

/**
 * Serves a runtime created by `create` to the main thread over comlink. The runtime is built on `init`,
 * inside the worker, so the GPU device and every cache live off the main thread.
 */
export function serveRuntime(
  create: (clientId: string | undefined) => Promise<LocalRuntime<readonly AnyTool[]>>,
): void {
  let runtime: LocalRuntime<readonly AnyTool[]> | null = null;
  const documents = new Map<number, LocalDocument>();
  const views = new Map<number, LocalView>();
  const canvases = new Map<number, OffscreenCanvas>();
  /** Open exports: the document's queue stays held until `end` is called. */
  const exports = new Map<number, { source: ExportSource; end: () => void }>();
  let nextId = 1;
  const rt = () => {
    if (!runtime) throw new Error('Runtime is not initialized');
    return runtime;
  };
  const doc = (id: number) => documents.get(id) ?? fail(`Unknown document ${id}`);
  const view = (id: number) => views.get(id) ?? fail(`Unknown view ${id}`);
  const exportSession = (session: number) => exports.get(session) ?? fail(`Unknown export ${session}`);

  const api: WorkerApi = {
    async init({ clientId }) {
      runtime ??= await create(clientId);
      return runtime.registry;
    },
    subscribeRuntime(listener) {
      const r = rt();
      listener(r.getSnapshot());
      r.subscribe(() => listener(r.getSnapshot()));
    },
    setTool: (id) => rt().setTool(id),
    setToolOptions: (id, options) => rt().setToolOptions(id, options),
    runToolCommand: (id, command) => rt().runToolCommand(id, command),
    setResources: (resources) => rt().setResources(resources),
    createDocument(options) {
      const id = nextId++;
      documents.set(id, rt().createDocument(options));
      return id;
    },
    subscribeDocument(id, listener) {
      const d = doc(id);
      listener(d.getSnapshot());
      d.subscribe(() => listener(d.getSnapshot()));
    },
    dispatch: (id, drafts) => doc(id).dispatch(drafts),
    undo: (id) => doc(id).undo(),
    redo: (id) => doc(id).redo(),
    setActiveNode: (id, nodeId) => doc(id).setActiveNode(nodeId),
    setQuickMask: (id, enabled) => doc(id).setQuickMask(enabled),
    setEditingMask: (id, enabled) => doc(id).setEditingMask(enabled),
    setFilterPreview: (id, preview) => doc(id).setFilterPreview(preview),
    serialize: async (id) => {
      const bytes = await doc(id).serialize();
      return Comlink.transfer(bytes, [bytes.buffer]);
    },
    beginExport: (id) =>
      new Promise((resolve, reject) => {
        const session = nextId++;
        doc(id)
          .export(
            (source) =>
              new Promise<void>((end) => {
                exports.set(session, { source, end });
                resolve({ session, width: source.width, height: source.height });
              }),
          )
          .catch(reject);
      }),
    // Pixels are copied rather than transferred: the source keeps the composite for the merged root layer.
    exportComposite: (session) => exportSession(session).source.composite(),
    exportLayers: (session) => exportSession(session).source.layers(),
    endExport(session) {
      exports.get(session)?.end();
      exports.delete(session);
    },
    collabConnect: (id, port) => doc(id).connect(portTransport(port)),
    collabDisconnect: (id) => doc(id).disconnect(),
    setPresence: (id, presence) => doc(id).setPresence(presence),
    disposeDocument(id) {
      doc(id).dispose();
      documents.delete(id);
    },
    createView(documentId, handle, options) {
      if (handle.canvas) canvases.set(handle.id, handle.canvas);
      const canvas = canvases.get(handle.id) ?? fail(`Unknown canvas ${handle.id}`);
      const id = nextId++;
      views.set(id, rt().createView(canvas, doc(documentId), options));
      return id;
    },
    subscribeView(id, listener) {
      const v = view(id);
      listener(v.getSnapshot());
      v.subscribe(() => listener(v.getSnapshot()));
    },
    viewPointer: (id, inputs) => views.get(id)?.handlePointer(inputs),
    viewKey: (id, kind, event) => views.get(id)?.handleKey(kind, event),
    viewWheel: (id, input) => views.get(id)?.handleWheel(input),
    viewResize: (id, size) => views.get(id)?.resize(size),
    setViewport: (id, viewport) => view(id).setViewport(viewport),
    setViewOverlay: (id, shapes) => view(id).setOverlay(shapes),
    disposeView(id) {
      views.get(id)?.dispose();
      views.delete(id);
    },
    dispose() {
      for (const { end } of exports.values()) end();
      exports.clear();
      for (const v of views.values()) v.dispose();
      for (const d of documents.values()) d.dispose();
      runtime?.dispose();
      runtime = null;
    },
  };
  Comlink.expose(api);
}

function fail(message: string): never {
  throw new Error(message);
}
