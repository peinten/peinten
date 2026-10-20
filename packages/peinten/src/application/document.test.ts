import { describe, expect, it } from 'vitest';
import { type FakeCache, newLocalDocument } from '../../test/fakes.ts';
import { hashTiles, samplesOf } from '../../test/helpers.ts';
import { resolveBrush } from '../domain/brush/resolve-brush.ts';
import { DEFAULT_BRUSH } from '../domain/brush/settings.ts';
import { previewStrokeSamples } from '../domain/brush/stroke-samples.ts';
import type { PaintLayer } from '../domain/document/nodes.ts';
import { ops } from '../domain/ops/factories.ts';

const brush = resolveBrush({ color: [0.2, 0.3, 0.9], brush: DEFAULT_BRUSH, eraser: false, size: 12, opacity: null });

const layerTiles = (state: { nodes: ReadonlyMap<string, unknown> }) => (state.nodes.get('L') as PaintLayer).tiles;

describe('LocalDocument', () => {
  it('renders a live stroke exactly like replaying its operation', async () => {
    const { document } = newLocalDocument();
    const handle = document.beginStroke({ brush, seed: 3 })!;
    for (const sample of samplesOf(previewStrokeSamples({ width: 128, height: 64 }))) handle.addSample(sample);
    await handle.end();
    const live = hashTiles(layerTiles(document.state));

    const { document: replay } = newLocalDocument();
    await replay.dispatch(
      ops.stroke({
        target: { nodeId: 'L' },
        brush,
        samples: previewStrokeSamples({ width: 128, height: 64 }),
        seed: 3,
      }),
    );
    expect(hashTiles(layerTiles(replay.state))).toBe(live);
    expect(layerTiles(document.state).size).toBeGreaterThan(0);
  });

  it('changes pixelsVersion only when the pixels change, not with thumbnails or properties', async () => {
    const { document, scheduler } = newLocalDocument();
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const node = () => document.getSnapshot().nodes.L!;
    await document.dispatch(ops.putPixels({ nodeId: 'L', x: 0, y: 0, width: 4, height: 4, data }));
    scheduler.flush();
    const painted = node();
    // The thumbnail arrives in a later frame and replaces the node snapshot.
    for (let i = 0; i < 10 && node().thumbnail === painted.thumbnail; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      scheduler.flush();
    }
    expect(node().thumbnail).not.toBe(painted.thumbnail);
    expect(node().pixelsVersion).toBe(painted.pixelsVersion);
    await document.dispatch(ops.updateNode({ nodeId: 'L', props: { opacity: 0.5 } }));
    scheduler.flush();
    expect(node().pixelsVersion).toBe(painted.pixelsVersion);
    await document.dispatch(ops.putPixels({ nodeId: 'L', x: 8, y: 0, width: 4, height: 4, data }));
    scheduler.flush();
    expect(node().pixelsVersion).not.toBe(painted.pixelsVersion);
  });

  it('reports the selection bounds to the pixel', async () => {
    const { document, scheduler } = newLocalDocument();
    await document.dispatch(
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 10, y: 5, width: 20, height: 7 } }),
    );
    scheduler.flush();
    expect(document.getSnapshot().selection?.bounds).toEqual({ x: 10, y: 5, width: 20, height: 7 });
  });

  it('undoes a canvas resize', async () => {
    const { document, scheduler } = newLocalDocument();
    await document.dispatch(ops.resizeCanvas({ width: 300, height: 90, offsetX: 10 }));
    scheduler.flush();
    expect([document.getSnapshot().width, document.getSnapshot().height]).toEqual([300, 90]);
    await document.undo();
    scheduler.flush();
    expect([document.getSnapshot().width, document.getSnapshot().height]).toEqual([128, 128]);
    // The fake cache sees every size the frames draw.
    expect((document.cache as FakeCache).source!.state.width).toBe(128);
  });

  it('holds edits back while an exporter reads the document', async () => {
    const { document } = newLocalDocument();
    let started!: () => void;
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const exported = document.export(async (source) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return source.layers();
    });
    await reading;
    const added = document.dispatch(ops.addLayer({ name: 'Late' }));
    await Promise.resolve();
    expect(document.state.nodes.size).toBe(1);
    release();
    expect((await exported).map((layer) => layer.name)).toEqual(['Layer 1']);
    await added;
    expect(document.state.nodes.size).toBe(2);
  });

  it('keeps the exact state object when a stroke is cancelled', async () => {
    const { document } = newLocalDocument();
    const before = document.state;
    const handle = document.beginStroke({ brush })!;
    for (const sample of samplesOf(previewStrokeSamples({ width: 128, height: 64 }))) handle.addSample(sample);
    handle.cancel();
    await document.dispatch([]);
    expect(document.state).toBe(before);
  });

  it('undoes an array dispatch as one step and redoes it', async () => {
    const { document, scheduler } = newLocalDocument();
    const group = ops.addGroup();
    await document.dispatch([group, ops.moveNode({ nodeId: 'L', parentId: group.nodeId, index: 0 })]);
    expect(document.state.rootIds).toEqual([group.nodeId]);
    await document.undo();
    expect(document.state.rootIds).toEqual(['L']);
    scheduler.flush();
    expect(document.getSnapshot().history).toEqual({ canUndo: false, canRedo: true });
    await document.redo();
    expect(document.state.rootIds).toEqual([group.nodeId]);
  });

  it('treats undo during a stroke as cancelling the stroke', async () => {
    const { document } = newLocalDocument();
    await document.dispatch(ops.addLayer({ name: 'kept' }));
    const handle = document.beginStroke({ brush })!;
    handle.addSample(samplesOf(previewStrokeSamples({ width: 128, height: 64 }))[5]!);
    await document.undo();
    await document.dispatch([]);
    expect([...document.state.nodes.values()].some((node) => node.name === 'kept')).toBe(true);
  });

  it('clips live strokes to the selection and paints the selection in quick mask mode', async () => {
    const { document } = newLocalDocument({ width: 256, height: 128 });
    await document.dispatch(
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 64, height: 128 } }),
    );
    const handle = document.beginStroke({ brush })!;
    for (const sample of samplesOf(previewStrokeSamples({ width: 256, height: 128 }))) handle.addSample(sample);
    await handle.end();
    const columns = [...layerTiles(document.state).keys()].map((key) => (key % 65536) - 32768);
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((tx) => tx === 0)).toBe(true);

    document.setQuickMask(true);
    const before = document.state.selections.get('me');
    const mask = document.beginStroke({ brush })!;
    for (const sample of samplesOf(previewStrokeSamples({ width: 256, height: 128 }))) mask.addSample(sample);
    await mask.end();
    expect(document.state.selections.get('me')).not.toBe(before);
    expect(document.state.selections.get('me')!.size).toBeGreaterThan(before!.size);
  });

  it('keeps snapshot identity when nothing changed', () => {
    const { document, scheduler } = newLocalDocument();
    scheduler.flush();
    const first = document.getSnapshot();
    document.requestFrame();
    scheduler.flush();
    expect(document.getSnapshot()).toBe(first);
  });
});
