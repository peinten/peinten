import { describe, expect, it } from 'vitest';
import { applyAll, newDoc, opContext, registry, stamp } from '../../../test/helpers.ts';
import { resolveBrush } from '../brush/resolve-brush.ts';
import { DEFAULT_BRUSH } from '../brush/settings.ts';
import { previewStrokeSamples } from '../brush/stroke-samples.ts';
import { maskValue } from '../document/layer-mask.ts';
import type { LayerMask, PaintLayer } from '../document/nodes.ts';
import type { DocState } from '../document/state.ts';
import { tilesToRgba8 } from '../raster/pixels.ts';
import { renderMaskThumbnail } from '../raster/thumbnail.ts';
import { FIX15_ONE } from '../tiles/tile.ts';
import { ops } from './factories.ts';
import { OperationConflictError } from './operation.ts';

const mask = (state: DocState, id = 'L') => state.nodes.get(id)!.mask as LayerMask;
const red = new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 1 || i % 4 === 2 ? 0 : 255));
const selectLeft = ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 20, height: 64 } });

describe('layer masks', () => {
  it('starts revealing, hiding or showing the issuer selection', async () => {
    const revealed = await applyAll(newDoc(), [ops.addMask({ nodeId: 'L' })]);
    expect(maskValue(mask(revealed), 100, 100)).toBe(1);
    expect(mask(revealed).tiles.size).toBe(0);
    const hidden = await applyAll(newDoc(), [ops.addMask({ nodeId: 'L', from: 'hide' })]);
    expect(maskValue(mask(hidden), 100, 100)).toBe(0);
    const selected = await applyAll(newDoc(), [selectLeft, ops.addMask({ nodeId: 'L', from: 'selection' })]);
    expect([maskValue(mask(selected), 5, 5), maskValue(mask(selected), 30, 5)]).toEqual([1, 0]);
  });

  it('inverts, disables, removes and applies', async () => {
    let state = await applyAll(newDoc(), [
      ops.putPixels({ nodeId: 'L', x: 0, y: 0, width: 64, height: 64, data: red }),
      selectLeft,
      ops.addMask({ nodeId: 'L', from: 'selection' }),
      ops.updateMask({ nodeId: 'L', invert: true, enabled: false }),
    ]);
    expect([maskValue(mask(state), 5, 5), maskValue(mask(state), 30, 5), maskValue(mask(state), 200, 5)]).toEqual([
      0, 1, 1,
    ]);
    expect(mask(state).enabled).toBe(false);
    state = await applyAll(state, [ops.updateMask({ nodeId: 'L', enabled: true }), ops.applyMask({ nodeId: 'L' })]);
    const layer = state.nodes.get('L') as PaintLayer;
    expect(layer.mask).toBeUndefined();
    expect([...tilesToRgba8(layer.tiles, { x: 5, y: 5, width: 1, height: 1 })]).toEqual([0, 0, 0, 0]);
    expect([...tilesToRgba8(layer.tiles, { x: 30, y: 5, width: 1, height: 1 })]).toEqual([255, 0, 0, 255]);
    const removed = await applyAll(newDoc(), [ops.addMask({ nodeId: 'L' }), ops.removeMask({ nodeId: 'L' })]);
    expect(removed.nodes.get('L')!.mask).toBeUndefined();
  });

  it('keeps hidden areas hidden when the canvas grows', async () => {
    const state = await applyAll(newDoc(64, 64), [
      ops.addMask({ nodeId: 'L', from: 'hide' }),
      ops.updateMask({ nodeId: 'L', invert: true }),
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 64, height: 64 } }),
      ops.addMask({ nodeId: 'L', from: 'selection' }),
      ops.updateMask({ nodeId: 'L', invert: true }),
      ops.resizeCanvas({ width: 200, height: 200, offsetX: 70, offsetY: 70 }),
    ]);
    // The old canvas was fully hidden and moved to (70, 70); the area around it takes the inverted fill.
    expect(maskValue(mask(state), 100, 100)).toBe(0);
    expect(maskValue(mask(state), 10, 10)).toBe(1);
  });

  it('paints the brush color lightness into the mask, inside the selection', async () => {
    const white = resolveBrush({ color: [1, 1, 1], brush: DEFAULT_BRUSH, eraser: false, size: 30, opacity: null });
    const black = resolveBrush({ color: [0, 0, 0], brush: DEFAULT_BRUSH, eraser: false, size: 30, opacity: null });
    const stroke = (brush: typeof white) =>
      ops.stroke({
        target: { maskOf: 'L' },
        brush,
        samples: previewStrokeSamples({ width: 128, height: 64 }),
        seed: 1,
      });
    const hidden = await applyAll(newDoc(), [ops.addMask({ nodeId: 'L', from: 'hide' }), stroke(white)]);
    expect(Math.max(...[...mask(hidden).tiles.values()].map((t) => Math.max(...t)))).toBeGreaterThan(30000);
    const selectHalf = ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 64, height: 64 } });
    const revealed = await applyAll(newDoc(), [ops.addMask({ nodeId: 'L' }), selectHalf, stroke(black)]);
    const values = (x: number) => [...Array(64)].map((_, y) => maskValue(mask(revealed), x, y));
    // Black hides where the stroke passes inside the selection, and nothing changes outside it.
    expect(Math.min(...values(50))).toBeLessThan(0.5);
    expect(Math.min(...values(80))).toBe(1);
  });

  it('refuses masks on locked layers and strokes on missing masks', async () => {
    const locked = await applyAll(newDoc(), [ops.updateNode({ nodeId: 'L', props: { locked: true } })]);
    expect(() => registry.get('add-mask').apply(locked, stamp(ops.addMask({ nodeId: 'L' })), opContext)).toThrow(
      OperationConflictError,
    );
    const brush = resolveBrush({ color: [1, 1, 1], brush: DEFAULT_BRUSH, eraser: false, size: 10, opacity: null });
    const draft = ops.stroke({
      target: { maskOf: 'L' },
      brush,
      samples: previewStrokeSamples({ width: 40, height: 20 }),
      seed: 1,
    });
    expect(() => registry.get('stroke').apply(newDoc(), stamp(draft), opContext)).toThrow(OperationConflictError);
  });
});

describe('mask thumbnails', () => {
  it('render the mask as gray, using the fill where there are no tiles', async () => {
    const state = await applyAll(newDoc(128, 64), [
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 64, height: 64 } }),
      ops.addMask({ nodeId: 'L', from: 'selection' }),
    ]);
    const { data, width, height } = renderMaskThumbnail(mask(state).tiles, 0, 128, 64, 32);
    expect([width, height]).toEqual([32, 16]);
    expect([...data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...data.slice((width - 1) * 4, width * 4)]).toEqual([0, 0, 0, 255]);
    expect(renderMaskThumbnail(new Map(), FIX15_ONE, 128, 64, 32).data[0]).toBe(255);
  });
});
