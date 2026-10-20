import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { useDevice } from '../../../test/gpu.ts';
import { applyAll, newDoc, opContext, registry, stamp } from '../../../test/helpers.ts';
import type { PaintLayer } from '../../domain/document/nodes.ts';
import type { DocState } from '../../domain/document/state.ts';
import { FilterRegistry, gaussianBlurFilter } from '../../domain/filters/filter.ts';
import type { OpContext } from '../../domain/ops/context.ts';
import { ops } from '../../domain/ops/factories.ts';
import { tilesToRgba8 } from '../../domain/raster/pixels.ts';
import { GpuFilterExecutor } from './filter-executor.ts';
import type { FilterKernel } from './filter-pass.ts';
import { GpuShared } from './gpu-shared.ts';

// The filter below is the example of the "Custom filters" docs page; this test keeps that example working.

declare module '../../domain/filters/filter.ts' {
  interface FilterParamsMap {
    invert: { readonly amount: number };
  }
}

const INVERT_WGSL = /* wgsl */ `
struct Params {
  region: vec4i,
  inputOffset: vec2i,
  inputSize: vec2i,
  outputOffset: vec2i,
  maskOffset: vec2i,
  maskSize: vec2i,
  amount: u32,
  useMask: u32,
}

@group(0) @binding(0) var src: texture_2d<u32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16uint, write>;
@group(0) @binding(2) var mask: texture_2d<u32>;
@group(0) @binding(3) var<uniform> p: Params;

fn inside(t: vec2i, size: vec2i) -> bool {
  return t.x >= 0 && t.y >= 0 && t.x < size.x && t.y < size.y;
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (i32(g.x) >= p.region.z || i32(g.y) >= p.region.w) { return; }
  let doc = p.region.xy + vec2i(g.xy);
  let t = doc - p.inputOffset;
  var c = vec4u(0u);
  if (inside(t, p.inputSize)) { c = textureLoad(src, t, 0); }
  // Pixels are premultiplied, so the inverse of a color is alpha minus the color.
  let inverted = vec4u(vec3u(c.a) - c.rgb, c.a);
  var weight = p.amount;
  if (p.useMask != 0u) {
    let m = doc - p.maskOffset;
    var coverage = 0u;
    if (inside(m, p.maskSize)) { coverage = textureLoad(mask, m, 0).r; }
    weight = (weight * coverage + 16384u) >> 15u;
  }
  let result = (inverted * weight + c * (32768u - weight) + vec4u(16384u)) >> vec4u(15u);
  textureStore(dst, doc - p.outputOffset, result);
}
`;

function createInvertKernel(device: GPUDevice): FilterKernel {
  const module = device.createShaderModule({ label: 'invert', code: INVERT_WGSL });
  const pipeline = device.createComputePipeline({
    label: 'invert',
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  // Bind groups need every binding, so passes without a selection bind this empty mask.
  const noMask = device.createTexture({ size: [1, 1], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING });
  return {
    type: 'invert',
    encode(encoder, args) {
      if (args.filter.type !== 'invert') throw new Error(`Unexpected filter ${args.filter.type}`);
      const { region, inputOffset, inputSize, outputOffset, mask } = args;
      const params = Int32Array.of(
        region.x,
        region.y,
        region.width,
        region.height,
        inputOffset[0],
        inputOffset[1],
        inputSize[0],
        inputSize[1],
        outputOffset[0],
        outputOffset[1],
        mask?.offset[0] ?? 0,
        mask?.offset[1] ?? 0,
        mask?.size[0] ?? 0,
        mask?.size[1] ?? 0,
        // fix15, rounded the same way on every peer
        Math.round(args.filter.amount * 32768),
        mask ? 1 : 0,
      );
      const uniforms = device.createBuffer({
        size: params.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(uniforms, 0, params);
      args.transients.push(uniforms);
      const pass = encoder.beginComputePass({ label: 'invert' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: args.input },
            { binding: 1, resource: args.output },
            { binding: 2, resource: mask?.view ?? noMask.createView() },
            { binding: 3, resource: { buffer: uniforms } },
          ],
        }),
      );
      pass.dispatchWorkgroups(Math.ceil(region.width / 16), Math.ceil(region.height / 16));
      pass.end();
    },
    dispose() {
      noMask.destroy();
    },
  };
}

const invertDefinition = {
  type: 'invert',
  schema: v.object({ amount: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) }),
  margin: () => 0,
} as const;

const device = await useDevice();
const filters = new FilterRegistry([gaussianBlurFilter, invertDefinition]);
const gpu = new GpuShared(device, [createInvertKernel(device)]);
const context: OpContext = { ...opContext, filters, filterExecutor: new GpuFilterExecutor(gpu, filters) };

async function apply(state: DocState, drafts: Parameters<typeof applyAll>[1]): Promise<DocState> {
  let next = state;
  for (const draft of drafts) next = await registry.get(draft.type).apply(next, stamp(draft), context);
  return next;
}

describe('custom filters', () => {
  it('runs a registered kernel, clipped to the selection', async () => {
    const data = new Uint8ClampedArray(40 * 20 * 4).map((_, i) => [200, 60, 20, 255][i % 4]!);
    let state = await applyAll(newDoc(96, 64), [
      ops.putPixels({ nodeId: 'L', x: 0, y: 0, width: 40, height: 20, data }),
      ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 0, y: 0, width: 20, height: 20 } }),
    ]);
    state = await apply(state, [ops.applyFilter({ nodeId: 'L', filter: { type: 'invert', amount: 1 } })]);
    const pixels = tilesToRgba8((state.nodes.get('L') as PaintLayer).tiles, { x: 0, y: 0, width: 40, height: 20 });
    const at = (x: number) => [...pixels.slice(x * 4, x * 4 + 4)];
    for (const [actual, expected] of at(5).map((c, i) => [c, [55, 195, 235, 255][i]!])) {
      expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(1);
    }
    expect(at(30)).toEqual([200, 60, 20, 255]);
  });
});
