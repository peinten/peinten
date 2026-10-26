import { describe, expect, it } from 'vitest';
import { useDevice } from '../../../test/gpu.ts';
import { applyAll, hashTiles, newDoc, opContext, registry, stamp } from '../../../test/helpers.ts';
import type { RenderSource } from '../../application/ports/renderer.ts';
import type { PaintLayer } from '../../domain/document/nodes.ts';
import type { DocState } from '../../domain/document/state.ts';
import type { OpContext } from '../../domain/ops/context.ts';
import { ops } from '../../domain/ops/factories.ts';
import { tilesToRgba8 } from '../../domain/raster/pixels.ts';
import { DocumentGpuCache } from './document-cache.ts';
import { GpuFilterExecutor } from './filter-executor.ts';
import { GpuShared } from './gpu-shared.ts';

const device = await useDevice();
const gpu = new GpuShared(device);
const context: OpContext = { ...opContext, filterExecutor: new GpuFilterExecutor(gpu, opContext.filters) };
const blur = { type: 'gaussian-blur', radius: 6 } as const;
const W = 160;
const H = 128;

const source = (state: DocState): RenderSource => ({
  state,
  live: [],
  textRasters: new Map(),
  selection: state.selections.get('me') ?? null,
  liveSelection: null,
  liveMask: null,
  quickMask: false,
  selectionOffset: null,
  warpPreview: null,
  filterPreview: null,
});
const noHint = { liveKeys: new Map(), liveSelectionKeys: [], liveMaskKeys: [] };

async function apply(state: DocState, drafts: Parameters<typeof applyAll>[1]): Promise<DocState> {
  let next = state;
  for (const draft of drafts) next = await registry.get(draft.type).apply(next, stamp(draft), context);
  return next;
}

/** A layer with a sharp-edged square and a gradient, so blurring changes many pixels. */
async function painted(): Promise<DocState> {
  const data = new Uint8ClampedArray(70 * 50 * 4);
  for (let y = 0; y < 50; y++) {
    for (let x = 0; x < 70; x++) data.set([x * 3, 255 - y * 4, 120, x < 35 ? 255 : 180], (y * 70 + x) * 4);
  }
  return applyAll(newDoc(W, H), [ops.putPixels({ nodeId: 'L', x: 40, y: 30, width: 70, height: 50, data })]);
}

async function composite(state: DocState): Promise<Uint8ClampedArray> {
  const cache = new DocumentGpuCache(gpu, opContext.filters, W, H);
  cache.sync(source(state), noHint);
  const pixels = await cache.readComposite();
  cache.dispose();
  return pixels;
}

const tilesOf = (state: DocState) => (state.nodes.get('L') as PaintLayer).tiles;

describe('GPU filters', () => {
  it('produces identical tiles for identical input', async () => {
    const base = await painted();
    const a = await apply(base, [ops.applyFilter({ nodeId: 'L', filter: blur })]);
    const b = await apply(base, [ops.applyFilter({ nodeId: 'L', filter: blur })]);
    expect(hashTiles(tilesOf(a))).toBe(hashTiles(tilesOf(b)));
    expect(hashTiles(tilesOf(a))).not.toBe(hashTiles(tilesOf(base)));
  });

  it('gives the same pixels destructively and through an adjustment layer', async () => {
    const base = await painted();
    const destructive = await apply(base, [ops.applyFilter({ nodeId: 'L', filter: blur })]);
    const adjusted = await apply(base, [ops.addAdjustmentLayer({ filter: blur })]);
    expect(await composite(adjusted)).toEqual(await composite(destructive));
  });

  it('treats pixels beyond the document as transparent on both paths', async () => {
    // Imported pixels are not clipped to the document, so this layer has content past the right edge.
    const data = new Uint8ClampedArray(40 * 30 * 4).fill(255);
    const base = await applyAll(newDoc(W, H), [
      ops.putPixels({ nodeId: 'L', x: W - 20, y: 40, width: 40, height: 30, data }),
    ]);
    const destructive = await apply(base, [ops.applyFilter({ nodeId: 'L', filter: blur })]);
    const adjusted = await apply(base, [ops.addAdjustmentLayer({ filter: blur })]);
    expect(await composite(adjusted)).toEqual(await composite(destructive));
  });

  it('leaves pixels outside the selection untouched', async () => {
    const base = await painted();
    const selected = await apply(base, [
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 75, height: H } }),
    ]);
    const result = await apply(selected, [ops.applyFilter({ nodeId: 'L', filter: blur })]);
    const right = { x: 76, y: 0, width: W - 76, height: H };
    expect(tilesToRgba8(tilesOf(result), right)).toEqual(tilesToRgba8(tilesOf(base), right));
    const left = { x: 0, y: 0, width: 70, height: H };
    expect(tilesToRgba8(tilesOf(result), left)).not.toEqual(tilesToRgba8(tilesOf(base), left));
  });

  it('keeps an adjustment layer inside its group, even for pass-through groups', async () => {
    const base = await painted();
    const group = ops.addGroup();
    const inside = await apply(base, [group, ops.addAdjustmentLayer({ parentId: group.nodeId, filter: blur })]);
    const passThrough = await apply(inside, [ops.updateNode({ nodeId: group.nodeId, props: { passThrough: true } })]);
    const plain = await composite(base);
    expect(await composite(inside)).toEqual(plain);
    expect(await composite(passThrough)).toEqual(plain);
  });
});
