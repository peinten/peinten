import { describe, expect, it } from 'vitest';
import { FakeCache, ManualScheduler } from '../../test/fakes.ts';
import { opContext, registry } from '../../test/helpers.ts';
import type { RenderBackend } from './ports/renderer.ts';
import { LocalRuntime, type RuntimeDeps } from './runtime.ts';
import type { ITool } from './tool.ts';

/** A tool whose UI state is a fresh object on every call, as most tools do. */
class ProbeTool implements ITool<'probe', { size: number }, { busy: boolean }> {
  readonly id = 'probe';
  readonly defaultOptions = { size: 1 };
  getUIState() {
    return { busy: false };
  }
}

function runtime() {
  const deps = {
    backend: {} as RenderBackend,
    mixer: opContext.mixer,
    filters: opContext.filters,
    registry,
    clientId: 'me',
    registryHash: 'test',
    onError: (error: unknown) => {
      throw error;
    },
  } as unknown as RuntimeDeps;
  return new LocalRuntime(deps, [new ProbeTool()] as const);
}

describe('LocalRuntime snapshots', () => {
  it('keeps the identity of parts that did not change', () => {
    const rt = runtime();
    const before = rt.getSnapshot();
    rt.setResources({ size: 12 });
    const after = rt.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.tool).toBe(before.tool);
    rt.setToolOptions('probe', { size: 3 });
    expect(rt.getSnapshot().tool).not.toBe(before.tool);
    expect(rt.getSnapshot().resources).toBe(after.resources);
  });
});

/** Records activation so tests can see when the runtime binds it to a view. */
class OverlayTool implements ITool<'overlay'> {
  readonly id = 'overlay';
  readonly defaultOptions = {};
  activations = 0;
  activate(): void {
    this.activations++;
  }
}

describe('LocalRuntime tool binding', () => {
  it('activates a newly selected tool on the view that last received input', () => {
    const probe = new ProbeTool();
    const overlay = new OverlayTool();
    const scheduler = new ManualScheduler();
    const backend = {
      maxDocumentSize: 8192,
      filterExecutor: opContext.filterExecutor,
      createDocumentCache: () => new FakeCache(),
      createViewSurface: () => ({ resize() {}, render() {}, dispose() {} }),
    } as unknown as RenderBackend;
    const rt = new LocalRuntime(
      {
        backend,
        mixer: opContext.mixer,
        filters: opContext.filters,
        registry,
        scheduler,
        thumbnails: { create: async () => ({ close() {} }) as ImageBitmap },
        clientId: 'me',
        registryHash: 'test',
        onError: (error: unknown) => {
          throw error;
        },
      } as unknown as RuntimeDeps,
      [probe, overlay] as const,
    );
    const doc = rt.createDocument({ width: 64, height: 64 });
    const view = rt.createView({} as OffscreenCanvas, doc, { input: true, navigation: true, background: 'checker' });
    // Before any input there is no view to bind to.
    rt.setTool('overlay');
    expect(overlay.activations).toBe(0);
    view.handleKey('down', {
      key: 'a',
      code: 'KeyA',
      repeat: false,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    });
    expect(overlay.activations).toBe(1);
    rt.setTool('probe');
    rt.setTool('overlay');
    expect(overlay.activations).toBe(2);
  });
});
