import type { WarpMesh } from '../../domain/raster/warp.ts';
import { TILE_SIZE } from '../../domain/tiles/tile.ts';
import type { Rect } from '../../domain/tiles/tile-map.ts';
import { EMPTY_SLOT } from './compositor.ts';
import { PAGE_TILES } from './tile-atlas.ts';

const WARP_WGSL = /* wgsl */ `
struct Params {
  docSize: vec2f,
  useSelection: u32,
  pad: u32,
  sourceRect: vec4i,
  tableOrigin: vec2i,
  tableSize: vec2i,
}

@group(0) @binding(0) var atlas: texture_2d_array<u32>;
@group(0) @binding(1) var<storage, read> table: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var selection: texture_2d<u32>;

struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex
fn vs(@location(0) p: vec3f, @location(1) uv: vec2f) -> VsOut {
  // Homogeneous destination point -> clip space; the GPU interpolates uv perspective-correctly.
  var out: VsOut;
  out.pos = vec4f(2.0 * p.x / params.docSize.x - p.z, p.z - 2.0 * p.y / params.docSize.y, 0.0, p.z);
  out.uv = uv;
  return out;
}

fn texel(q: vec2i) -> vec4f {
  let r = params.sourceRect;
  if (q.x < r.x || q.y < r.y || q.x >= r.x + r.z || q.y >= r.y + r.w) { return vec4f(0.0); }
  let tile = vec2i(floor(vec2f(q) / ${TILE_SIZE}.0)) - params.tableOrigin;
  if (tile.x < 0 || tile.y < 0 || tile.x >= params.tableSize.x || tile.y >= params.tableSize.y) { return vec4f(0.0); }
  let slot = table[tile.y * params.tableSize.x + tile.x];
  if (slot == ${EMPTY_SLOT}u) { return vec4f(0.0); }
  let page = slot / ${PAGE_TILES * PAGE_TILES}u;
  let index = slot % ${PAGE_TILES * PAGE_TILES}u;
  let local = vec2u(q - (tile + params.tableOrigin) * ${TILE_SIZE});
  let value = vec4f(textureLoad(atlas, vec2u(index % ${PAGE_TILES}u, index / ${PAGE_TILES}u) * ${TILE_SIZE}u + local, page, 0)) / 32768.0;
  if (params.useSelection == 0u) { return value; }
  return value * f32(textureLoad(selection, vec2u(q), 0).r) / 32768.0;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4u {
  let s = in.uv + vec2f(params.sourceRect.xy) - 0.5;
  let base = vec2i(floor(s));
  let f = s - floor(s);
  let c = mix(mix(texel(base), texel(base + vec2i(1, 0)), f.x), mix(texel(base + vec2i(0, 1)), texel(base + vec2i(1, 1)), f.x), f.y);
  return vec4u(round(clamp(c, vec4f(0.0), vec4f(1.0)) * 32768.0));
}
`;

export interface WarpPreviewDraw {
  readonly target: GPUTextureView;
  readonly atlas: GPUTextureView;
  readonly selection: GPUTextureView;
  readonly useSelection: boolean;
  readonly docWidth: number;
  readonly docHeight: number;
  readonly source: Rect;
  readonly mesh: WarpMesh;
  /** Atlas slot of each source tile, row-major over the tiles covering `source`. */
  readonly table: Uint32Array;
  readonly tableOrigin: readonly [number, number];
  readonly tableSize: readonly [number, number];
}

/** Renders the warped content of one layer into a document-sized texture for the warp preview. */
export class WarpPreviewRenderer {
  readonly #device: GPUDevice;
  readonly #pipeline: GPURenderPipeline;
  readonly #layout: GPUBindGroupLayout;

  constructor(device: GPUDevice) {
    this.#device = device;
    const module = device.createShaderModule({ label: 'warp preview', code: WARP_WGSL });
    this.#layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint', viewDimension: '2d-array' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      ],
    });
    this.#pipeline = device.createRenderPipeline({
      label: 'warp preview',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.#layout] }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16uint' }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  encode(encoder: GPUCommandEncoder, d: WarpPreviewDraw, transients: GPUBuffer[]): void {
    const { mesh, source } = d;
    const vertices: number[] = [];
    const vertex = (i: number, j: number) => {
      const o = (j * (mesh.cols + 1) + i) * 3;
      vertices.push(
        mesh.points[o]!,
        mesh.points[o + 1]!,
        mesh.points[o + 2]!,
        (i / mesh.cols) * source.width,
        (j / mesh.rows) * source.height,
      );
    };
    for (let j = 0; j < mesh.rows; j++) {
      for (let i = 0; i < mesh.cols; i++) {
        vertex(i, j);
        vertex(i + 1, j);
        vertex(i + 1, j + 1);
        vertex(i, j);
        vertex(i + 1, j + 1);
        vertex(i, j + 1);
      }
    }
    const device = this.#device;
    const make = (data: ArrayBufferView, usage: number) => {
      const buffer = device.createBuffer({
        size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, data as GPUAllowSharedBufferSource);
      transients.push(buffer);
      return buffer;
    };
    const params = new ArrayBuffer(48);
    new Float32Array(params, 0, 2).set([d.docWidth, d.docHeight]);
    new Uint32Array(params, 8, 2).set([d.useSelection ? 1 : 0, 0]);
    new Int32Array(params, 16, 8).set([
      source.x,
      source.y,
      source.width,
      source.height,
      d.tableOrigin[0],
      d.tableOrigin[1],
      d.tableSize[0],
      d.tableSize[1],
    ]);
    const bindGroup = device.createBindGroup({
      layout: this.#layout,
      entries: [
        { binding: 0, resource: d.atlas },
        {
          binding: 1,
          resource: { buffer: make(d.table.length ? d.table : new Uint32Array(4), GPUBufferUsage.STORAGE) },
        },
        { binding: 2, resource: { buffer: make(new Uint8Array(params), GPUBufferUsage.UNIFORM) } },
        { binding: 3, resource: d.selection },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: 'warp preview',
      colorAttachments: [{ view: d.target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
    });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, make(new Float32Array(vertices), GPUBufferUsage.VERTEX));
    pass.draw(vertices.length / 5);
    pass.end();
  }
}
