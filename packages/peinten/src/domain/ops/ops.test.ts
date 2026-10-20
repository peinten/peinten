import { describe, expect, it } from 'vitest';
import { applyAll, hashTiles, newDoc, opContext, registry, stamp } from '../../../test/helpers.ts';
import type { PaintLayer, TextLayer } from '../document/nodes.ts';
import { selectionCoverage } from '../document/selection.ts';
import { MAX_DOCUMENT_SIZE } from '../document/state.ts';
import { rgba8ToTiles, tilesToRgba8 } from '../raster/pixels.ts';
import { TILE_SIZE } from '../tiles/tile.ts';
import { ops } from './factories.ts';
import { OperationConflictError } from './operation.ts';

function coverage(mask: ReadonlyMap<number, Uint16Array> | undefined): number {
  let sum = 0;
  for (const tile of mask?.values() ?? []) for (const v of tile) sum += v;
  return sum / 32768;
}

describe('node operations', () => {
  it('adds, nests, moves and removes nodes', async () => {
    const group = ops.addGroup({ name: 'G' });
    const layer = ops.addLayer({ name: 'A' });
    let state = await applyAll(newDoc(), [
      group,
      layer,
      ops.moveNode({ nodeId: layer.nodeId, parentId: group.nodeId, index: 0 }),
    ]);
    expect(state.rootIds).toEqual(['L', group.nodeId]);
    const g = state.nodes.get(group.nodeId);
    expect(g?.kind === 'group' && g.childIds).toEqual([layer.nodeId]);
    expect(state.nodes.get(layer.nodeId)?.parentId).toBe(group.nodeId);
    state = await applyAll(state, [ops.removeNode({ nodeId: group.nodeId })]);
    expect(state.nodes.has(layer.nodeId)).toBe(false);
    expect(state.rootIds).toEqual(['L']);
  });

  it('refuses to move a group into itself', async () => {
    const group = ops.addGroup();
    const state = await applyAll(newDoc(), [group]);
    expect(() =>
      registry
        .get('move-node')
        .apply(state, stamp(ops.moveNode({ nodeId: group.nodeId, parentId: group.nodeId, index: 0 })), opContext),
    ).toThrow(OperationConflictError);
  });

  it('duplicates groups with deterministic descendant ids and shared tiles', async () => {
    const group = ops.addGroup();
    const child = ops.addLayer({ parentId: group.nodeId });
    const dup = ops.duplicateNode({ nodeId: group.nodeId });
    const state = await applyAll(newDoc(), [group, child, dup]);
    const copy = state.nodes.get(dup.newNodeId);
    expect(copy?.kind === 'group' && copy.childIds).toEqual([`${dup.newNodeId}/${child.nodeId}`]);
    expect(state.rootIds.indexOf(dup.newNodeId)).toBe(state.rootIds.indexOf(group.nodeId) + 1);
  });

  it('ignores props that do not apply to the node kind', async () => {
    const state = await applyAll(newDoc(), [
      ops.updateNode({ nodeId: 'L', props: { opacity: 0.5, passThrough: true, blendMode: 'multiply' } }),
    ]);
    expect(state.nodes.get('L')).toMatchObject({ opacity: 0.5, blendMode: 'multiply' });
    expect(state.nodes.get('L')).not.toHaveProperty('passThrough');
  });
});

describe('selection operations', () => {
  it('rasterizes rectangles with exact area anti-aliasing', async () => {
    const state = await applyAll(newDoc(), [
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 10.5, y: 20.25, width: 30, height: 15.5 } }),
    ]);
    expect(coverage(state.selections.get('me'))).toBeCloseTo(30 * 15.5, 0);
  });

  it('approximates ellipse area and combines modes', async () => {
    let state = await applyAll(newDoc(), [
      ops.selectShape({ mode: 'replace', shape: { kind: 'ellipse', cx: 100, cy: 100, rx: 40, ry: 20 } }),
    ]);
    expect(coverage(state.selections.get('me')) / (Math.PI * 800)).toBeCloseTo(1, 2);
    state = await applyAll(state, [
      ops.selectShape({ mode: 'subtract', shape: { kind: 'rect', x: 0, y: 0, width: 100, height: 256 } }),
    ]);
    expect(coverage(state.selections.get('me')) / (Math.PI * 400)).toBeCloseTo(1, 2);
    state = await applyAll(state, [
      ops.selectShape({ mode: 'intersect', shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 } }),
    ]);
    expect(state.selections.has('me')).toBe(false);
  });

  it('keeps selections per client', async () => {
    let state = await applyAll(newDoc(), [ops.selectAll()], 'alice');
    state = await applyAll(
      state,
      [ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 8, height: 8 } })],
      'bob',
    );
    expect(coverage(state.selections.get('alice'))).toBe(256 * 256);
    expect(coverage(state.selections.get('bob'))).toBe(64);
    state = await applyAll(state, [ops.invertSelection()], 'bob');
    expect(coverage(state.selections.get('bob'))).toBe(256 * 256 - 64);
  });

  it('moves the selection outline by whole pixels, dropping what leaves the document', async () => {
    const select = ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 60, y: 0, width: 10, height: 10.5 } });
    let state = await applyAll(newDoc(), [select, ops.moveSelection({ dx: 10, dy: 5 })]);
    const mask = state.selections.get('me')!;
    expect(selectionCoverage(mask, 75, 10)).toBe(1);
    expect(selectionCoverage(mask, 65, 2)).toBe(0);
    // The anti-aliased bottom row keeps its partial coverage at its new place.
    expect(selectionCoverage(mask, 72, 15)).toBeCloseTo(0.5, 3);
    expect(coverage(mask)).toBeCloseTo(105, 3);
    state = await applyAll(state, [ops.moveSelection({ dx: 180, dy: 0 })]);
    expect(coverage(state.selections.get('me'))).toBeCloseTo(6 * 10.5, 3);
    state = await applyAll(state, [ops.moveSelection({ dx: 100, dy: 0 })]);
    expect(state.selections.has('me')).toBe(false);
  });

  it('selects matching connected pixels with the magic wand', async () => {
    const data = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const x = i % 64;
      data.set(x < 20 || x >= 40 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    }
    const base = await applyAll(newDoc(64, 64), [
      ops.putPixels({ nodeId: 'L', x: 0, y: 0, width: 64, height: 64, data }),
    ]);
    const contiguous = await applyAll(base, [
      ops.selectWand({ mode: 'replace', nodeId: 'L', x: 5, y: 5, tolerance: 0.1, contiguous: true }),
    ]);
    expect(coverage(contiguous.selections.get('me'))).toBe(20 * 64);
    const global = await applyAll(base, [
      ops.selectWand({ mode: 'replace', nodeId: 'L', x: 5, y: 5, tolerance: 0.1, contiguous: false }),
    ]);
    expect(coverage(global.selections.get('me'))).toBe(44 * 64);
  });
});

describe('warp', () => {
  const mesh = (dx: number, dy: number, size: number) => ({
    cols: 1,
    rows: 1,
    points: [dx, dy, 1, size + dx, dy, 1, dx, size + dy, 1, size + dx, size + dy, 1],
  });

  it('leaves pixels unchanged with an identity mesh and shifts exactly by integers', async () => {
    const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).map((_, i) => (i * 37) % 256);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const base = await applyAll(newDoc(), [ops.putPixels({ nodeId: 'L', x: 0, y: 0, width: 64, height: 64, data })]);
    const layer = (s: typeof base) => (s.nodes.get('L') as { tiles: ReadonlyMap<number, Uint16Array> }).tiles;
    const identity = await applyAll(base, [
      ops.warp({ nodeId: 'L', source: { x: 0, y: 0, width: 64, height: 64 }, mesh: mesh(0, 0, 64) }),
    ]);
    expect(hashTiles(layer(identity))).toBe(hashTiles(layer(base)));

    const shifted = await applyAll(base, [
      ops.warp({ nodeId: 'L', source: { x: 0, y: 0, width: 64, height: 64 }, mesh: mesh(70, 3, 64) }),
    ]);
    const expected = tilesToRgba8(layer(base), { x: 0, y: 0, width: 64, height: 64 });
    const moved = tilesToRgba8(layer(shifted), { x: 70, y: 3, width: 64, height: 64 });
    expect(moved).toEqual(expected);
    expect(tilesToRgba8(layer(shifted), { x: 0, y: 0, width: 64, height: 3 }).every((v) => v === 0)).toBe(true);
  });

  it('round-trips 8-bit pixels through fix15 tiles', () => {
    const data = new Uint8ClampedArray([255, 128, 0, 255, 10, 20, 30, 128]);
    expect(tilesToRgba8(rgba8ToTiles(data, 2, 1, 5, 7), { x: 5, y: 7, width: 2, height: 1 })).toEqual(data);
  });
});

describe('canvas size', () => {
  it('moves layers, text and selections by the offset and crops to the new canvas', async () => {
    const text = ops.addTextLayer({ name: 'Title' });
    const red = new Uint8ClampedArray(4 * 4 * 4).map((_, i) => (i % 4 === 1 || i % 4 === 2 ? 0 : 255));
    let state = await applyAll(newDoc(256, 256), [
      ops.putPixels({ nodeId: 'L', x: 10, y: 10, width: 4, height: 4, data: red }),
      text,
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 20, height: 20 } }),
    ]);
    const before = (state.nodes.get(text.nodeId) as TextLayer).text.transform;
    state = await applyAll(state, [ops.resizeCanvas({ width: 100, height: 50, offsetX: -8, offsetY: 30 })]);
    expect([state.width, state.height]).toEqual([100, 50]);
    const tiles = (state.nodes.get('L') as PaintLayer).tiles;
    expect([...tilesToRgba8(tiles, { x: 2, y: 40, width: 1, height: 1 })]).toEqual([255, 0, 0, 255]);
    // Rows 44.. of the moved block fall below the new canvas.
    expect(tilesToRgba8(tiles, { x: 2, y: 44, width: 4, height: 6 }).every((v) => v === 0)).toBe(true);
    const after = (state.nodes.get(text.nodeId) as TextLayer).text.transform;
    expect([after[4] - before[4], after[5] - before[5]]).toEqual([-8, 30]);
    const mask = state.selections.get('me')!;
    expect(selectionCoverage(mask, 11, 49)).toBe(1);
    expect(selectionCoverage(mask, 12, 40)).toBe(0);
  });

  it('refuses sizes beyond the document limit', () => {
    const op = { ...ops.resizeCanvas({ width: MAX_DOCUMENT_SIZE + 1, height: 10 }), id: 'o', clientId: 'me' };
    expect(() => registry.parse(op)).toThrow();
  });
});
