import type {
  CreateDocumentOptions,
  CreateViewOptions,
  PaintDocument,
  PaintRuntime,
  PaintView,
  RuntimeSnapshot,
} from '../application/api.ts';
import type { LocalDocument } from '../application/document.ts';
import type { LocalRuntime } from '../application/runtime.ts';
import type { AnyTool, ToolCommand, ToolId, ToolOptions } from '../application/tool.ts';
import type { BrushResources } from '../domain/brush/resolve-brush.ts';
import { captureInput } from './input/capture.ts';

const documents = new WeakMap<PaintDocument, LocalDocument>();

/** Exposes a LocalRuntime running on the main thread through the async PaintRuntime interface. */
export class MainThreadRuntime<T extends readonly AnyTool[]> implements PaintRuntime<T> {
  readonly #runtime: LocalRuntime<T>;

  constructor(runtime: LocalRuntime<T>) {
    this.#runtime = runtime;
  }

  get registry(): string {
    return this.#runtime.registry;
  }

  subscribe = (listener: () => void) => this.#runtime.subscribe(listener);
  getSnapshot = (): RuntimeSnapshot<T> => this.#runtime.getSnapshot();

  async createDocument(options: CreateDocumentOptions): Promise<PaintDocument> {
    const local = this.#runtime.createDocument(options);
    const document: PaintDocument = {
      dispatch: (op) => local.dispatch(op),
      undo: () => local.undo(),
      redo: () => local.redo(),
      setActiveNode: async (id) => local.setActiveNode(id),
      setQuickMask: async (enabled) => local.setQuickMask(enabled),
      setEditingMask: async (enabled) => local.setEditingMask(enabled),
      setFilterPreview: async (preview) => local.setFilterPreview(preview),
      serialize: () => local.serialize(),
      export: (exporter) => local.export(exporter),
      collab: {
        connect: async (transport) => local.connect(transport),
        disconnect: () => local.disconnect(),
        setPresence: async (presence) => local.setPresence(presence),
      },
      subscribe: local.subscribe,
      getSnapshot: local.getSnapshot,
      dispose: async () => local.dispose(),
    };
    documents.set(document, local);
    return document;
  }

  async createView(options: CreateViewOptions): Promise<PaintView> {
    const local = documents.get(options.document);
    if (!local) throw new Error('The document does not belong to this runtime');
    const input = options.input ?? true;
    const view = this.#runtime.createView(options.canvas, local, {
      input: input !== false,
      navigation: input !== false && (input === true || input.navigation !== false),
      background: options.background ?? 'checker',
    });
    const release = captureInput(
      options.canvas,
      {
        pointer: (inputs) => view.handlePointer(inputs),
        key: (kind, event) => view.handleKey(kind, event),
        wheel: (wheel) => view.handleWheel(wheel),
        resize: (size) => view.resize(size),
      },
      input !== false,
    );
    return {
      setViewport: async (viewport) => view.setViewport(viewport),
      setOverlay: async (shapes) => view.setOverlay(shapes),
      subscribe: view.subscribe,
      getSnapshot: view.getSnapshot,
      dispose: async () => {
        release();
        view.dispose();
      },
    };
  }

  async setTool(id: ToolId<T>): Promise<void> {
    this.#runtime.setTool(id);
  }

  async setToolOptions<Id extends ToolId<T>>(id: Id, options: Partial<ToolOptions<T, Id>>): Promise<void> {
    this.#runtime.setToolOptions(id, options as object);
  }

  async runToolCommand<Id extends ToolId<T>>(id: Id, command: ToolCommand<T, Id>): Promise<void> {
    this.#runtime.runToolCommand(id, command);
  }

  async setResources(resources: Partial<BrushResources>): Promise<void> {
    this.#runtime.setResources(resources);
  }

  async dispose(): Promise<void> {
    this.#runtime.dispose();
  }
}
