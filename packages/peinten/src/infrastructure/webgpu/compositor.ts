import { TILE_SIZE } from '../../domain/tiles/tile.ts';
import { PAGE_TILES } from './tile-atlas.ts';
import { BLEND_WGSL } from './wgsl/blend.ts';

/**
 * Composite instructions. Each is a vec4<u32>: [op, argument, blend mode, opacity bits].
 * The tree is flattened into a stack program; groups push a transparent entry and pop by blending it down.
 */
export const OP = {
  /** Blend the atlas tile `argument` onto the top of the stack. */
  layer: 1,
  /** Blend layer `argument` of the results array (document coordinates). */
  result: 2,
  /**
   * Apply the filter output texture (document coordinates) as an adjustment layer. In normal mode the filtered
   * image replaces the backdrop by opacity, so a blur never shows the sharp original through transparent areas.
   */
  filterOut: 3,
  push: 4,
  /** Pop the top entry and blend it onto the new top. */
  pop: 5,
  /** Replace the top of the stack with results layer `argument`. */
  base: 6,
  /** Blend atlas tile `argument` with the warp preview applied (lifted content plus warped content). */
  warpLayer: 7,
} as const;

/** Atlas slot meaning "no tile here", used where an instruction must run even without layer content. */
export const EMPTY_SLOT = 0xffffffff;

const MAX_STACK = 16;

function compositeWgsl(output: 'rgba16float' | 'rgba16uint'): string {
  const store =
    output === 'rgba16float'
      ? 'textureStore(output, px, stack[0]);'
      : 'textureStore(output, px, vec4u(round(clamp(stack[0], vec4f(0.0), vec4f(1.0)) * 32768.0)));';
  return /* wgsl */ `
${BLEND_WGSL}

struct TileHeader { tx: u32, ty: u32, offset: u32, count: u32 }
struct Params { docSize: vec2u, warpUseSelection: u32, pad: u32, warpRect: vec4i }

@group(0) @binding(0) var atlas: texture_2d_array<u32>;
@group(0) @binding(1) var results: texture_2d_array<u32>;
@group(0) @binding(2) var filterOut: texture_2d<u32>;
@group(0) @binding(3) var selection: texture_2d<u32>;
@group(0) @binding(4) var warped: texture_2d<u32>;
@group(0) @binding(5) var<storage, read> headers: array<TileHeader>;
@group(0) @binding(6) var<storage, read> instructions: array<vec4u>;
@group(0) @binding(7) var<uniform> params: Params;
@group(0) @binding(8) var output: texture_storage_2d<${output}, write>;

fn fix15(v: vec4u) -> vec4f { return vec4f(v) / 32768.0; }

fn loadAtlas(slot: u32, local: vec2u) -> vec4f {
  if (slot == ${EMPTY_SLOT}u) { return vec4f(0.0); }
  let page = slot / ${PAGE_TILES * PAGE_TILES}u;
  let index = slot % ${PAGE_TILES * PAGE_TILES}u;
  let texel = vec2u(index % ${PAGE_TILES}u, index / ${PAGE_TILES}u) * ${TILE_SIZE}u + local;
  return fix15(textureLoad(atlas, texel, page, 0));
}

fn liftCoverage(px: vec2u) -> f32 {
  let p = vec2i(px);
  let r = params.warpRect;
  if (p.x < r.x || p.y < r.y || p.x >= r.x + r.z || p.y >= r.y + r.w) { return 0.0; }
  if (params.warpUseSelection == 0u) { return 1.0; }
  return f32(textureLoad(selection, px, 0).r) / 32768.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let header = headers[gid.z];
  let local = gid.xy;
  let px = vec2u(header.tx * ${TILE_SIZE}u + local.x, header.ty * ${TILE_SIZE}u + local.y);
  if (px.x >= params.docSize.x || px.y >= params.docSize.y) { return; }
  var stack: array<vec4f, ${MAX_STACK}>;
  var sp = 0u;
  stack[0] = vec4f(0.0);
  for (var i = header.offset; i < header.offset + header.count; i++) {
    let ins = instructions[i];
    let mode = ins.z;
    let opacity = bitcast<f32>(ins.w);
    switch ins.x {
      case ${OP.layer}u: { stack[sp] = blendOver(stack[sp], loadAtlas(ins.y, local), mode, opacity); }
      case ${OP.result}u: { stack[sp] = blendOver(stack[sp], fix15(textureLoad(results, px, ins.y, 0)), mode, opacity); }
      case ${OP.filterOut}u: {
        let filtered = fix15(textureLoad(filterOut, px, 0));
        if (mode == 0u) { stack[sp] = mix(stack[sp], filtered, opacity); }
        else { stack[sp] = blendOver(stack[sp], filtered, mode, opacity); }
      }
      case ${OP.push}u: {
        sp = min(sp + 1u, ${MAX_STACK - 1}u);
        stack[sp] = vec4f(0.0);
      }
      case ${OP.pop}u: {
        let top = stack[sp];
        sp = max(sp, 1u) - 1u;
        stack[sp] = blendOver(stack[sp], top, mode, opacity);
      }
      case ${OP.base}u: { stack[sp] = fix15(textureLoad(results, px, ins.y, 0)); }
      case ${OP.warpLayer}u: {
        let lifted = loadAtlas(ins.y, local) * (1.0 - liftCoverage(px));
        let moved = fix15(textureLoad(warped, px, 0));
        stack[sp] = blendOver(stack[sp], moved + lifted * (1.0 - moved.a), mode, opacity);
      }
      default: {}
    }
  }
  ${store}
}
`;
}

/** Maximum group nesting the composite stack supports. Deeper groups composite as if they were pass-through. */
export const MAX_GROUP_DEPTH = MAX_STACK - 1;

export interface CompositeDispatch {
  readonly output: GPUTextureView;
  readonly outputKind: 'rgba16float' | 'rgba16uint';
  readonly atlas: GPUTextureView;
  readonly results: GPUTextureView;
  readonly filterOut: GPUTextureView;
  readonly selection: GPUTextureView;
  readonly warped: GPUTextureView;
  /** [tx, ty, offset, count] per tile. */
  readonly headers: Uint32Array;
  readonly instructions: Uint32Array;
  readonly docWidth: number;
  readonly docHeight: number;
  readonly warpRect: readonly [number, number, number, number];
  readonly warpUseSelection: boolean;
}

/** Runtime-wide compositing pipelines. Documents feed it their own programs and textures. */
export class Compositor {
  readonly #device: GPUDevice;
  readonly #layouts: Record<'rgba16float' | 'rgba16uint', GPUBindGroupLayout>;
  readonly #pipelines: Record<'rgba16float' | 'rgba16uint', GPUComputePipeline>;

  constructor(device: GPUDevice) {
    this.#device = device;
    const make = (format: 'rgba16float' | 'rgba16uint') => {
      const uintTexture = { sampleType: 'uint' } as const;
      const layout = device.createBindGroupLayout({
        label: `composite ${format}`,
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { ...uintTexture, viewDimension: '2d-array' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { ...uintTexture, viewDimension: '2d-array' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: uintTexture },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: uintTexture },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: uintTexture },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { format, access: 'write-only' } },
        ],
      });
      const pipeline = device.createComputePipeline({
        label: `composite ${format}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: {
          module: device.createShaderModule({ label: `composite ${format}`, code: compositeWgsl(format) }),
          entryPoint: 'main',
        },
      });
      return { layout, pipeline };
    };
    const float = make('rgba16float');
    const uint = make('rgba16uint');
    this.#layouts = { rgba16float: float.layout, rgba16uint: uint.layout };
    this.#pipelines = { rgba16float: float.pipeline, rgba16uint: uint.pipeline };
  }

  /** Records one composite pass over the tiles listed in `headers`. */
  encode(encoder: GPUCommandEncoder, d: CompositeDispatch, transients: GPUBuffer[]): void {
    const tiles = d.headers.length / 4;
    if (tiles === 0) return;
    // Documents are capped at 8192 px, i.e. 16384 tiles, below the 65535 workgroups allowed along z.
    if (tiles > 65535) throw new Error('Too many tiles in one composite pass');
    const device = this.#device;
    const buffer = (data: ArrayBufferView, usage: number) => {
      const b = device.createBuffer({
        size: Math.max(16, Math.ceil(data.byteLength / 16) * 16),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(b, 0, data as GPUAllowSharedBufferSource);
      transients.push(b);
      return b;
    };
    const params = new ArrayBuffer(32);
    new Uint32Array(params, 0, 4).set([d.docWidth, d.docHeight, d.warpUseSelection ? 1 : 0, 0]);
    new Int32Array(params, 16, 4).set(d.warpRect);
    const bindGroup = device.createBindGroup({
      layout: this.#layouts[d.outputKind],
      entries: [
        { binding: 0, resource: d.atlas },
        { binding: 1, resource: d.results },
        { binding: 2, resource: d.filterOut },
        { binding: 3, resource: d.selection },
        { binding: 4, resource: d.warped },
        { binding: 5, resource: { buffer: buffer(d.headers, GPUBufferUsage.STORAGE) } },
        {
          binding: 6,
          resource: {
            buffer: buffer(d.instructions.length ? d.instructions : new Uint32Array(4), GPUBufferUsage.STORAGE),
          },
        },
        { binding: 7, resource: { buffer: buffer(new Uint8Array(params), GPUBufferUsage.UNIFORM) } },
        { binding: 8, resource: d.output },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'composite' });
    pass.setPipeline(this.#pipelines[d.outputKind]);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(TILE_SIZE / 8, TILE_SIZE / 8, tiles);
    pass.end();
  }
}
