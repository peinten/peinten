import { describe, expect, it } from 'vitest';
import { useDevice } from '../../../test/gpu.ts';
import { applyAll, newDoc, opContext } from '../../../test/helpers.ts';
import type { RenderSource } from '../../application/ports/renderer.ts';
import { BLEND_MODES, type BlendMode } from '../../domain/document/blend-mode.ts';
import type { DocState } from '../../domain/document/state.ts';
import { ops } from '../../domain/ops/factories.ts';
import { DocumentGpuCache } from './document-cache.ts';
import { GpuShared } from './gpu-shared.ts';

const device = await useDevice();
const gpu = new GpuShared(device);

function source(state: DocState, extra: Partial<RenderSource> = {}): RenderSource {
  return {
    state,
    live: [],
    textRasters: new Map(),
    selection: null,
    liveSelection: null,
    quickMask: false,
    selectionOffset: null,
    warpPreview: null,
    filterPreview: null,
    ...extra,
  };
}
const noHint = { liveKeys: new Map(), liveSelectionKeys: [] };

/** CPU reference of the W3C separable/non-separable formulas for one pixel of straight colors. */
function referenceBlend(mode: BlendMode, cb: number[], cs: number[]): number[] {
  const lum = (c: number[]) => 0.3 * c[0]! + 0.59 * c[1]! + 0.11 * c[2]!;
  const clip = (c: number[]) => {
    const l = lum(c);
    const n = Math.min(...c);
    const x = Math.max(...c);
    let o = c;
    if (n < 0) o = o.map((v) => l + ((v - l) * l) / (l - n));
    if (x > 1) o = o.map((v) => l + ((v - l) * (1 - l)) / (x - l));
    return o;
  };
  const setLum = (c: number[], l: number) => clip(c.map((v) => v + l - lum(c)));
  const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
  const setSat = (c: number[], s: number) => {
    const mx = Math.max(...c);
    const mn = Math.min(...c);
    return mx > mn ? c.map((v) => ((v - mn) * s) / (mx - mn)) : [0, 0, 0];
  };
  const dodge = (b: number, s: number) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
  const burn = (b: number, s: number) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
  const hard = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1));
  const soft = (b: number, s: number) =>
    s <= 0.5
      ? b - (1 - 2 * s) * b * (1 - b)
      : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
  const per = (f: (b: number, s: number) => number) => cb.map((b, i) => f(b, cs[i]!));
  switch (mode) {
    case 'normal':
      return cs;
    case 'multiply':
      return per((b, s) => b * s);
    case 'darken':
      return per(Math.min);
    case 'color-burn':
      return per(burn);
    case 'linear-burn':
      return per((b, s) => Math.max(0, b + s - 1));
    case 'darker-color':
      return lum(cs) < lum(cb) ? cs : cb;
    case 'screen':
      return per((b, s) => b + s - b * s);
    case 'lighten':
      return per(Math.max);
    case 'color-dodge':
      return per(dodge);
    case 'linear-dodge':
      return per((b, s) => Math.min(1, b + s));
    case 'lighter-color':
      return lum(cs) > lum(cb) ? cs : cb;
    case 'overlay':
      return per((b, s) => hard(s, b));
    case 'soft-light':
      return per(soft);
    case 'hard-light':
      return per(hard);
    case 'vivid-light':
      return per((b, s) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1)));
    case 'linear-light':
      return per((b, s) => Math.min(1, Math.max(0, b + 2 * s - 1)));
    case 'pin-light':
      return per((b, s) => (s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1)));
    case 'hard-mix':
      return per((b, s) => (b + s >= 1 ? 1 : 0));
    case 'difference':
      return per((b, s) => Math.abs(b - s));
    case 'exclusion':
      return per((b, s) => b + s - 2 * b * s);
    case 'subtract':
      return per((b, s) => Math.max(0, b - s));
    case 'divide':
      return per((b, s) => (s <= 0 ? (b > 0 ? 1 : 0) : Math.min(1, b / s)));
    case 'hue':
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation':
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color':
      return setLum(cs, lum(cb));
    case 'luminosity':
      return setLum(cb, lum(cs));
  }
}

async function fill(state: DocState, nodeId: string, rgba: readonly number[]) {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return applyAll(state, [ops.putPixels({ nodeId, x: 0, y: 0, width: 64, height: 64, data })]);
}

describe('GPU compositing', () => {
  it('blends opaque layers with every blend mode like the W3C formulas', async () => {
    const backdrop = [200, 90, 30];
    const top = [60, 170, 220];
    for (const mode of BLEND_MODES) {
      const add = ops.addLayer();
      let state = await fill(newDoc(64, 64), 'L', [...backdrop, 255]);
      state = await applyAll(state, [add, ops.updateNode({ nodeId: add.nodeId, props: { blendMode: mode } })]);
      state = await fill(state, add.nodeId, [...top, 255]);
      const cache = new DocumentGpuCache(gpu, opContext.filters, 64, 64);
      cache.sync(source(state), noHint);
      const pixels = await cache.readComposite();
      cache.dispose();
      const expected = referenceBlend(
        mode,
        backdrop.map((v) => v / 255),
        top.map((v) => v / 255),
      ).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255));
      const actual = [...pixels.subarray(0, 3)];
      for (let c = 0; c < 3; c++)
        expect(Math.abs(actual[c]! - expected[c]!), `${mode} channel ${c}`).toBeLessThanOrEqual(2);
    }
  });

  it('applies group opacity, pass-through and visibility', async () => {
    const group = ops.addGroup();
    const child = ops.addLayer({ parentId: group.nodeId });
    let state = await fill(newDoc(64, 64), 'L', [255, 255, 255, 255]);
    state = await applyAll(state, [group, child, ops.updateNode({ nodeId: group.nodeId, props: { opacity: 0.5 } })]);
    state = await fill(state, child.nodeId, [0, 0, 0, 255]);
    const cache = new DocumentGpuCache(gpu, opContext.filters, 64, 64);
    cache.sync(source(state), noHint);
    expect((await cache.readComposite())[0]).toBeCloseTo(128, -0.5);
    state = await applyAll(state, [ops.updateNode({ nodeId: group.nodeId, props: { visible: false } })]);
    cache.sync(source(state), noHint);
    expect((await cache.readComposite())[0]).toBe(255);
    cache.dispose();
  });

  it('recomposites only dirty tiles with the same result as a full composite', async () => {
    let state = await fill(newDoc(192, 128), 'L', [10, 200, 30, 255]);
    const cache = new DocumentGpuCache(gpu, opContext.filters, 192, 128);
    cache.sync(source(state), noHint);
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    state = await applyAll(state, [ops.putPixels({ nodeId: 'L', x: 100, y: 70, width: 20, height: 20, data })]);
    cache.sync(source(state), noHint);
    const incremental = await cache.readComposite();
    const fresh = new DocumentGpuCache(gpu, opContext.filters, 192, 128);
    fresh.sync(source(state), noHint);
    expect(incremental).toEqual(await fresh.readComposite());
    cache.dispose();
    fresh.dispose();
  });
});

describe('GPU warp preview', () => {
  it('matches the CPU warp within a small tolerance', async () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) data.set([x * 4, y * 4, 255 - x * 2, 255], (y * 64 + x) * 4);
    const base = await applyAll(newDoc(192, 192), [
      ops.putPixels({ nodeId: 'L', x: 32, y: 32, width: 64, height: 64, data }),
    ]);
    // Rotate by 20 degrees and scale by 1.3 around the source center, as a 4x4 mesh.
    const rect = { x: 32, y: 32, width: 64, height: 64 };
    const angle = (20 * Math.PI) / 180;
    const points: number[] = [];
    for (let j = 0; j <= 4; j++) {
      for (let i = 0; i <= 4; i++) {
        const u = (i / 4) * 64 - 32;
        const v = (j / 4) * 64 - 32;
        points.push(
          100 + (u * Math.cos(angle) - v * Math.sin(angle)) * 1.3,
          100 + (u * Math.sin(angle) + v * Math.cos(angle)) * 1.3,
          1,
        );
      }
    }
    const mesh = { cols: 4, rows: 4, points };
    const committed = await applyAll(base, [ops.warp({ nodeId: 'L', source: rect, mesh })]);

    const cpu = new DocumentGpuCache(gpu, opContext.filters, 192, 192);
    cpu.sync(source(committed), noHint);
    const expected = await cpu.readComposite();
    const preview = new DocumentGpuCache(gpu, opContext.filters, 192, 192);
    preview.sync(source(base, { warpPreview: { nodeId: 'L', source: rect, mesh } }), noHint);
    const actual = await preview.readComposite();
    cpu.dispose();
    preview.dispose();

    let total = 0;
    let big = 0;
    for (let i = 0; i < expected.length; i++) {
      const diff = Math.abs(expected[i]! - actual[i]!);
      total += diff;
      if (diff > 16) big++;
    }
    expect(total / expected.length).toBeLessThan(1);
    // Only anti-aliased edge pixels may differ noticeably.
    expect(big / (192 * 192)).toBeLessThan(0.01);
  });
});
