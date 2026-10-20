import { describe, expect, it } from 'vitest';
import { type FakeCache, newLocalDocument } from '../../../test/fakes.ts';
import { hashTiles, registry, samplesOf } from '../../../test/helpers.ts';
import type { LocalDocument } from '../../application/document.ts';
import { resolveBrush } from '../../domain/brush/resolve-brush.ts';
import { DEFAULT_BRUSH } from '../../domain/brush/settings.ts';
import { previewStrokeSamples } from '../../domain/brush/stroke-samples.ts';
import type { PaintLayer } from '../../domain/document/nodes.ts';
import type { DocState } from '../../domain/document/state.ts';
import { ops } from '../../domain/ops/factories.ts';
import { isEmptyTile } from '../../domain/tiles/tile.ts';
import { broadcastChannelTransport } from './broadcast-channel.ts';
import { decodeMessage, encodeMessage } from './codec.ts';
import { createInMemoryHub } from './in-memory-hub.ts';

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Order-independent summary of a state, comparable across peers whose maps were filled in different orders. */
function summarize(state: DocState) {
  return {
    rootIds: state.rootIds,
    nodes: [...state.nodes.keys()].sort().map((id) => {
      const node = state.nodes.get(id)!;
      return node.kind === 'paint' ? { ...node, tiles: hashTiles(node.tiles) } : node;
    }),
    selections: [...state.selections.keys()].sort().map((id) => [id, hashTiles(state.selections.get(id)!)]),
  };
}

function peer(clientId: string, extra: { registryHash?: string; onError?: (error: unknown) => void } = {}) {
  return newLocalDocument({ clientId, ...extra }).document;
}

/** Collaboration status as published in the snapshot; frames are driven by hand in tests. */
function status(doc: LocalDocument, scheduler: { flush(): void }) {
  scheduler.flush();
  return doc.getSnapshot().collab.status;
}

async function randomEdit(doc: LocalDocument, random: () => number): Promise<void> {
  const state = doc.state;
  const ids = [...state.nodes.keys()];
  const pick = () => ids[Math.floor(random() * ids.length)]!;
  const paint = ids.filter((id) => state.nodes.get(id)!.kind === 'paint');
  const choice = ids.length === 0 ? 0 : Math.floor(random() * 6);
  if (choice === 0) return doc.dispatch(ops.addLayer({ name: `L${Math.floor(random() * 1000)}` }));
  if (choice === 1 && paint.length) {
    const color = Math.floor(random() * 255);
    const data = new Uint8ClampedArray(8 * 8 * 4).map((_, i) => (i % 4 === 3 ? 255 : color));
    const x = Math.floor(random() * 100);
    return doc.dispatch(
      ops.putPixels({ nodeId: paint[Math.floor(random() * paint.length)]!, x, y: x, width: 8, height: 8, data }),
    );
  }
  if (choice === 2)
    return doc.dispatch(ops.updateNode({ nodeId: pick(), props: { opacity: Math.round(random() * 100) / 100 } }));
  if (choice === 3 && ids.length > 1) return doc.dispatch(ops.removeNode({ nodeId: pick() }));
  if (choice === 4)
    return doc.dispatch(ops.moveNode({ nodeId: pick(), parentId: null, index: Math.floor(random() * 3) }));
  if (choice === 5) {
    await doc.dispatch(
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 40, height: 40 } }),
    );
    return doc.undo();
  }
}

describe('collaboration', () => {
  it('converges for random edits, arrival orders, undo and reconnects', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const random = mulberry32(seed);
      const hub = createInMemoryHub({ registry: 'test', operations: registry, snapshotInterval: 15 });
      const errors: string[] = [];
      const docs = ['a', 'b', 'c'].map((id) => peer(id, { onError: (error) => errors.push((error as Error).message) }));
      const transports = docs.map((doc) => {
        const transport = hub.connect();
        doc.connect(transport);
        return transport;
      });
      await hub.settle(random);
      for (let round = 0; round < 40; round++) {
        const i = Math.floor(random() * docs.length);
        if (random() < 0.1) transports[i]!.setOnline(false);
        if (random() < 0.15) transports[i]!.setOnline(true);
        await randomEdit(docs[i]!, random);
        if (random() < 0.3) await docs[i]!.undo();
        if (random() < 0.4) await hub.settle(random);
      }
      for (const transport of transports) transport.setOnline(true);
      await hub.settle(random);
      const expected = summarize(docs[0]!.state);
      for (const doc of docs) expect(summarize(doc.state), `seed ${seed}`).toEqual(expected);
      // Concurrent edits conflict (e.g. both remove a node); such batches are skipped on every peer alike.
      for (const message of errors) expect(message).toMatch(/was skipped/);
    }
  });

  it('applies batches made while offline exactly once after reconnecting', async () => {
    const hub = createInMemoryHub({ registry: 'test' });
    const [a, b] = [peer('a'), peer('b')];
    const ta = hub.connect();
    a.connect(ta);
    b.connect(hub.connect());
    await hub.settle();
    ta.setOnline(false);
    await a.dispatch(ops.addLayer({ name: 'offline' }));
    ta.setOnline(true);
    await hub.settle();
    ta.setOnline(false);
    ta.setOnline(true);
    await hub.settle();
    const names = (doc: LocalDocument) =>
      [...doc.state.nodes.values()].map((n) => n.name).filter((n) => n === 'offline');
    expect(names(a)).toEqual(['offline']);
    expect(names(b)).toEqual(['offline']);
  });

  it('drops rejected batches and refuses mismatching registries', async () => {
    const errors: unknown[] = [];
    const hub = createInMemoryHub({ registry: 'test', authorize: (clientId) => clientId !== 'viewer' });
    const editor = peer('editor');
    const viewer = peer('viewer', { onError: (error) => errors.push(error) });
    const { document: stranger, scheduler } = newLocalDocument({
      clientId: 'stranger',
      registryHash: 'other',
      onError: (error) => errors.push(error),
    });
    editor.connect(hub.connect());
    viewer.connect(hub.connect());
    stranger.connect(hub.connect());
    await hub.settle();
    await viewer.dispatch(ops.addLayer({ name: 'nope' }));
    expect(viewer.state.nodes.size).toBe(2);
    await hub.settle();
    expect(viewer.state.nodes.size).toBe(1);
    expect(status(stranger, scheduler)).toBe('offline');
    const messages = errors.map((e) => (e as Error).message);
    expect(messages.some((m) => m.includes('rejected'))).toBe(true);
    expect(messages.some((m) => m.includes('registry-mismatch'))).toBe(true);
  });

  it('gives clients joining an empty room together the same base document', async () => {
    const hub = createInMemoryHub({ registry: 'test' });
    const a = newLocalDocument({ clientId: 'a' }).document;
    const b = newLocalDocument({ clientId: 'b', width: 128 }).document;
    // Different first-layer ids make the bases distinguishable.
    await b.dispatch(ops.addLayer({ name: 'only in b' }));
    a.connect(hub.connect());
    b.connect(hub.connect());
    await hub.settle();
    expect(summarize(b.state)).toEqual(summarize(a.state));
  });

  it('brings late joiners up to date from a snapshot, including selections', async () => {
    const hub = createInMemoryHub({ registry: 'test' });
    const a = peer('a');
    a.connect(hub.connect());
    await hub.settle();
    await a.dispatch(ops.addLayer({ name: 'early' }));
    await a.dispatch(ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 } }));
    await hub.settle();
    const late = peer('late');
    late.connect(hub.connect());
    await hub.settle();
    expect(summarize(late.state)).toEqual(summarize(a.state));
    expect(late.state.selections.has('a')).toBe(true);
  });

  it('keeps typed arrays through the message codec', () => {
    const samples = new Float32Array([1.5, 2.25]);
    const message = { t: 'submit', batchId: 'b', ops: [{ type: 'stroke', id: 'o', clientId: 'c', samples }] } as const;
    const decoded = decodeMessage(encodeMessage(message as never)) as typeof message;
    expect(decoded.ops[0].samples).toBeInstanceOf(Float32Array);
    expect([...decoded.ops[0].samples]).toEqual([1.5, 2.25]);
  });

  it('syncs tabs through BroadcastChannel and survives the leader leaving', async () => {
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    };
    const room = `test-${Math.random()}`;
    const [a, b] = [newLocalDocument({ clientId: 'a' }), newLocalDocument({ clientId: 'b' })].map((p) => ({
      doc: p.document,
      online: () => status(p.document, p.scheduler) === 'online',
    })) as [{ doc: LocalDocument; online: () => boolean }, { doc: LocalDocument; online: () => boolean }];
    a.doc.connect(broadcastChannelTransport({ room, registry: 'test' }));
    await until(a.online);
    b.doc.connect(broadcastChannelTransport({ room, registry: 'test' }));
    await until(b.online);
    await a.doc.dispatch(ops.addLayer({ name: 'from a' }));
    await until(() => [...b.doc.state.nodes.values()].some((n) => n.name === 'from a'));
    // `a` held the lock, so leaving hands leadership to `b`, which continues the log on its own.
    await a.doc.disconnect();
    await until(b.online);
    await b.doc.dispatch(ops.addLayer({ name: 'after leader left' }));
    // A newcomer only sees the layer if `b` now sequences and serves snapshots.
    const c = peer('c');
    c.connect(broadcastChannelTransport({ room, registry: 'test' }));
    await until(() => summarize(c.state).nodes.length === 3);
    expect(summarize(c.state)).toEqual(summarize(b.doc.state));
    await c.disconnect();
    await b.doc.disconnect();
  });
});

describe('stroke previews', () => {
  const brush = resolveBrush({ color: [0.8, 0.2, 0.1], brush: DEFAULT_BRUSH, eraser: false, size: 12, opacity: null });
  const samples = samplesOf(previewStrokeSamples({ width: 128, height: 64 }));

  async function room() {
    const hub = createInMemoryHub({ registry: 'test', operations: registry });
    const drawer = newLocalDocument({ clientId: 'a' });
    const viewer = newLocalDocument({ clientId: 'b' });
    drawer.document.connect(hub.connect());
    viewer.document.connect(hub.connect());
    await hub.settle();
    /** Lets the relay interval pass, delivers everything and returns the live tiles the viewer would draw. */
    const viewerLive = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await hub.settle();
      viewer.scheduler.flush();
      return (viewer.document.cache as FakeCache).source!.live;
    };
    return { drawer: drawer.document, viewer: viewer.document, viewerLive };
  }

  it('shows a stroke while the peer draws it and replaces it with an identical commit', async () => {
    const { drawer, viewer, viewerLive } = await room();
    const handle = drawer.beginStroke({ brush })!;
    for (const sample of samples.slice(0, samples.length / 2)) handle.addSample(sample);
    const partial = await viewerLive();
    expect(partial.map((live) => live.nodeId)).toEqual(['L']);
    expect(partial[0]!.tiles.size).toBeGreaterThan(0);

    for (const sample of samples.slice(samples.length / 2)) handle.addSample(sample);
    const [full] = await viewerLive();
    const preview = new Map([...full!.tiles].filter(([, tile]) => !isEmptyTile(tile)).map(([k, t]) => [k, t.slice()]));
    await handle.end();
    expect(await viewerLive()).toEqual([]);
    const committed = (viewer.state.nodes.get('L') as PaintLayer).tiles;
    expect(hashTiles(committed)).toBe(hashTiles((drawer.state.nodes.get('L') as PaintLayer).tiles));
    expect(hashTiles(preview)).toBe(hashTiles(committed));
  });

  it('drops the preview when the stroke is cancelled or its peer leaves', async () => {
    const { drawer, viewerLive } = await room();
    const cancelled = drawer.beginStroke({ brush })!;
    for (const sample of samples) cancelled.addSample(sample);
    expect(await viewerLive()).toHaveLength(1);
    cancelled.cancel();
    expect(await viewerLive()).toEqual([]);

    const abandoned = drawer.beginStroke({ brush })!;
    for (const sample of samples) abandoned.addSample(sample);
    expect(await viewerLive()).toHaveLength(1);
    // The stroke holds the drawer's queue, so the disconnect only finishes after it.
    const left = drawer.disconnect();
    expect(await viewerLive()).toEqual([]);
    await abandoned.end();
    await left;
  });
});
