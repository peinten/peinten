import { describe, expect, it } from 'vitest';
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
