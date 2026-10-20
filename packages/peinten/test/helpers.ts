import { libMyPaintPigmentMixer } from '../src/domain/brush/color-mixer.ts';
import { SAMPLE_STRIDE, type StrokeSample } from '../src/domain/brush/stroke-samples.ts';
import { createDocState, type DocState } from '../src/domain/document/state.ts';
import { FilterRegistry, gaussianBlurFilter } from '../src/domain/filters/filter.ts';
import type { OpContext } from '../src/domain/ops/context.ts';
import { coreOperations } from '../src/domain/ops/core.ts';
import { ops } from '../src/domain/ops/factories.ts';
import type { Operation, OperationDraft } from '../src/domain/ops/operation.ts';
import { OperationRegistry } from '../src/domain/ops/registry.ts';

export const registry = new OperationRegistry(coreOperations);

export const opContext: OpContext = {
  mixer: libMyPaintPigmentMixer,
  filters: new FilterRegistry([gaussianBlurFilter]),
  filterExecutor: {
    apply: () => {
      throw new Error('No GPU in unit tests');
    },
  },
};

let counter = 0;
export function stamp<D extends OperationDraft>(draft: D, clientId = 'me'): Operation<D> {
  return { ...draft, id: `op${counter++}`, clientId };
}

/** Applies drafts in order through the registry, as the timeline would. */
export async function applyAll(state: DocState, drafts: readonly OperationDraft[], clientId = 'me'): Promise<DocState> {
  let next = state;
  for (const draft of drafts) next = await registry.get(draft.type).apply(next, stamp(draft, clientId), opContext);
  return next;
}

export function newDoc(width = 256, height = 256): DocState {
  return createDocState(width, height, 'L');
}

/** Order-independent FNV hash of a tile map, for comparing pixel results. */
export function hashTiles(tiles: ReadonlyMap<number, Uint16Array>): string {
  let h = 0x811c9dc5;
  for (const key of [...tiles.keys()].sort((a, b) => a - b)) {
    h = Math.imul(h ^ key, 0x01000193) >>> 0;
    for (const value of tiles.get(key)!) h = Math.imul(h ^ value, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Splits samples in the `SAMPLE_STRIDE` layout into the objects a stroke handle takes. */
export function samplesOf(data: Float32Array): StrokeSample[] {
  const samples: StrokeSample[] = [];
  for (let o = 0; o < data.length; o += SAMPLE_STRIDE) {
    samples.push({
      x: data[o]!,
      y: data[o + 1]!,
      pressure: data[o + 2]!,
      xtilt: data[o + 3]!,
      ytilt: data[o + 4]!,
      dtime: data[o + 5]!,
      viewzoom: data[o + 6]!,
      viewrotation: data[o + 7]!,
      barrelRotation: data[o + 8]!,
    });
  }
  return samples;
}

/** A document with every node kind, painted pixels and a selection. */
export async function richDoc(): Promise<DocState> {
  const red = new Uint8ClampedArray(20 * 10 * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  const group = ops.addGroup({ name: 'Group' });
  const text = ops.addTextLayer({ parentId: group.nodeId, name: 'Title' });
  return applyAll(newDoc(), [
    ops.putPixels({ nodeId: 'L', x: 70, y: 5, width: 20, height: 10, data: red }),
    ops.updateNode({ nodeId: 'L', props: { blendMode: 'multiply', opacity: 0.5 } }),
    group,
    text,
    ops.addAdjustmentLayer({ name: 'Blur', filter: { type: 'gaussian-blur', radius: 4 } }),
    ops.updateNode({ nodeId: group.nodeId, props: { passThrough: true, visible: false } }),
    ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 30, height: 30 } }),
  ]);
}
