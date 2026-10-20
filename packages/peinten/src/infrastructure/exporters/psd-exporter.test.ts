import { initializeCanvas, readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { applyAll, richDoc } from '../../../test/helpers.ts';
import { createExportSource } from '../../application/export.ts';
import { ops } from '../../domain/ops/factories.ts';
import { rgba8ToTiles } from '../../domain/raster/pixels.ts';
import { psdExporter } from './psd-exporter.ts';

// Node has no canvas; reading back only needs plain pixel buffers.
initializeCanvas(
  () => {
    throw new Error('No canvas in tests');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

describe('PSD export', () => {
  it('writes the layer tree, flattening folders that contain adjustment layers', async () => {
    let state = await richDoc();
    const inner = ops.addGroup({ name: 'Adjusted' });
    state = await applyAll(state, [
      inner,
      ops.addAdjustmentLayer({ parentId: inner.nodeId, filter: { type: 'gaussian-blur', radius: 2 } }),
    ]);
    // The root also holds an adjustment layer, so move it into a folder of its own to keep the tree.
    const blur = [...state.nodes.values()].find((n) => n.kind === 'adjustment' && n.parentId === null)!;
    state = await applyAll(state, [ops.removeNode({ nodeId: blur.id })]);
    const size = state.width * state.height * 4;
    const textTiles = rgba8ToTiles(new Uint8ClampedArray(16).fill(255), 2, 2, 10, 10);
    const blob = await psdExporter()(
      createExportSource({
        state,
        readComposite: async () => new Uint8ClampedArray(size).fill(7),
        readGroup: async () => new Uint8ClampedArray(size).fill(9),
        textRaster: (id) => (state.nodes.get(id)?.kind === 'text' ? textTiles : undefined),
      }),
    );
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { useImageData: true });
    const [paint, group, adjusted] = psd.children!;
    expect(paint).toMatchObject({ name: 'Layer 1', blendMode: 'multiply', left: 70, top: 5, right: 90, bottom: 15 });
    expect(paint!.opacity).toBeCloseTo(0.5, 2);
    expect([...paint!.imageData!.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(group).toMatchObject({ name: 'Group', blendMode: 'pass through', hidden: true });
    expect(group!.children![0]!.text).toMatchObject({ text: 'Text', orientation: 'horizontal' });
    expect(group!.children![0]).toMatchObject({ left: 10, top: 10 });
    expect(adjusted).toMatchObject({ name: 'Adjusted', left: 0, top: 0, right: 256, bottom: 256 });
    expect(adjusted!.children).toBeUndefined();
    expect(adjusted!.imageData!.data[0]).toBe(9);
  });
});
