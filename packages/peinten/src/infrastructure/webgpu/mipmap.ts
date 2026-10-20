import type { Rect } from '../../domain/tiles/tile-map.ts';

const MIP_WGSL = /* wgsl */ `
struct Params { origin: vec2u, size: vec2u, srcSize: vec2u, pad: vec2u }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> p: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.size.x || g.y >= p.size.y) { return; }
  let d = p.origin + g.xy;
  var sum = vec4f(0.0);
  for (var dy = 0u; dy < 2u; dy++) {
    for (var dx = 0u; dx < 2u; dx++) {
      let s = min(d * 2u + vec2u(dx, dy), p.srcSize - 1u);
      sum += textureLoad(src, s, 0);
    }
  }
  textureStore(dst, d, sum * 0.25);
}
`;

/** Regenerates the mip chain of an `rgba16float` texture inside a rectangle of level 0. */
export class MipmapGenerator {
  readonly #device: GPUDevice;
  readonly #pipeline: GPUComputePipeline;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.#pipeline = device.createComputePipeline({
      label: 'mipmap',
      layout: 'auto',
      compute: { module: device.createShaderModule({ label: 'mipmap', code: MIP_WGSL }), entryPoint: 'main' },
    });
  }

  encode(encoder: GPUCommandEncoder, texture: GPUTexture, region: Rect, transients: GPUBuffer[]): void {
    let x0 = region.x;
    let y0 = region.y;
    let x1 = region.x + region.width;
    let y1 = region.y + region.height;
    for (let level = 1; level < texture.mipLevelCount; level++) {
      const srcWidth = Math.max(1, texture.width >> (level - 1));
      const srcHeight = Math.max(1, texture.height >> (level - 1));
      const width = Math.max(1, texture.width >> level);
      const height = Math.max(1, texture.height >> level);
      x0 = Math.floor(x0 / 2);
      y0 = Math.floor(y0 / 2);
      x1 = Math.min(Math.ceil(x1 / 2), width);
      y1 = Math.min(Math.ceil(y1 / 2), height);
      const params = this.#device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.#device.queue.writeBuffer(params, 0, new Uint32Array([x0, y0, x1 - x0, y1 - y0, srcWidth, srcHeight, 0, 0]));
      transients.push(params);
      const bindGroup = this.#device.createBindGroup({
        layout: this.#pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
          { binding: 2, resource: { buffer: params } },
        ],
      });
      const pass = encoder.beginComputePass({ label: `mip ${level}` });
      pass.setPipeline(this.#pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil((x1 - x0) / 8), Math.ceil((y1 - y0) / 8));
      pass.end();
    }
  }
}
