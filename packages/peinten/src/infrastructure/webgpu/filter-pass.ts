import type { FilterSpec } from '../../domain/filters/filter.ts';
import type { Rect } from '../../domain/tiles/tile-map.ts';

/** Inputs of one filter invocation. All rectangles and offsets are in document pixels. */
export interface FilterKernelArgs {
  readonly filter: FilterSpec;
  /** fix15 `rgba16uint` source; texel = document position - inputOffset. */
  readonly input: GPUTextureView;
  readonly inputOffset: readonly [number, number];
  readonly inputSize: readonly [number, number];
  /** `rgba16uint` storage target; texel = document position - outputOffset. */
  readonly output: GPUTextureView;
  readonly outputOffset: readonly [number, number];
  /** Output pixels to compute. */
  readonly region: Rect;
  /** Document bounds; everything outside reads as transparent. */
  readonly bounds: Rect;
  /** Optional `r16uint` coverage: the result is blended with the input by it. */
  readonly mask: {
    readonly view: GPUTextureView;
    readonly offset: readonly [number, number];
    readonly size: readonly [number, number];
  } | null;
  /** Buffers created for this invocation. The caller destroys them once the submitted work is done. */
  readonly transients: GPUBuffer[];
}

/** GPU implementation of one filter type. Kernels use integer math so every GPU produces identical results. */
export interface FilterKernel {
  readonly type: FilterSpec['type'];
  encode(encoder: GPUCommandEncoder, args: FilterKernelArgs): void;
  dispose(): void;
}

/**
 * The single entry point for running filters. Destructive application and adjustment layers both go through it,
 * so the two always produce the same pixels.
 */
export class FilterPass {
  readonly #kernels = new Map<string, FilterKernel>();

  constructor(kernels: readonly FilterKernel[]) {
    for (const kernel of kernels) this.#kernels.set(kernel.type, kernel);
  }

  encode(encoder: GPUCommandEncoder, args: FilterKernelArgs): void {
    const kernel = this.#kernels.get(args.filter.type);
    if (!kernel) throw new Error(`No GPU kernel for filter ${args.filter.type}`);
    kernel.encode(encoder, args);
  }

  dispose(): void {
    for (const kernel of this.#kernels.values()) kernel.dispose();
  }
}

/**
 * exp(x) for x <= 0 using only IEEE basic arithmetic, which is exactly reproducible on every JS engine.
 * Blur weights feed integer GPU math, so they must be bit-identical across peers.
 */
function deterministicExp(x: number): number {
  let k = 0;
  let r = x;
  while (r < -0.5) {
    r /= 2;
    k++;
  }
  let term = 1;
  let sum = 1;
  for (let i = 1; i < 20; i++) {
    term = (term * r) / i;
    sum += term;
  }
  for (let i = 0; i < k; i++) sum *= sum;
  return sum;
}

/** Integer Gaussian weights for offsets -m..m, summing to exactly 2^16. */
function blurWeights(radius: number): Uint32Array {
  const m = Math.ceil(radius);
  if (m === 0) return Uint32Array.of(65536);
  const sigma = radius / 3;
  const raw = Array.from({ length: m * 2 + 1 }, (_, i) => deterministicExp(-((i - m) ** 2) / (2 * sigma * sigma)));
  const total = raw.reduce((a, b) => a + b, 0);
  const weights = Uint32Array.from(raw, (w) => Math.floor((w / total) * 65536));
  const sum = weights.reduce((a, b) => a + b, 0);
  weights[m]! += 65536 - sum;
  return weights;
}

const BLUR_WGSL = /* wgsl */ `
struct Params {
  region: vec4i,
  inputOffset: vec2i,
  inputSize: vec2i,
  outputOffset: vec2i,
  maskOffset: vec2i,
  maskSize: vec2i,
  radius: i32,
  useMask: u32,
  bounds: vec4i,
  originalOffset: vec2i,
  pad: vec2i,
}

@group(0) @binding(0) var src: texture_2d<u32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16uint, write>;
@group(0) @binding(2) var<storage, read> weights: array<u32>;
@group(0) @binding(3) var<uniform> p: Params;
@group(0) @binding(4) var mask: texture_2d<u32>;
@group(0) @binding(5) var original: texture_2d<u32>;

fn inBounds(q: vec2i) -> bool {
  return q.x >= p.bounds.x && q.y >= p.bounds.y && q.x < p.bounds.x + p.bounds.z && q.y < p.bounds.y + p.bounds.w;
}

fn loadSrc(q: vec2i) -> vec4u {
  let t = q - p.inputOffset;
  if (!inBounds(q) || t.x < 0 || t.y < 0 || t.x >= p.inputSize.x || t.y >= p.inputSize.y) { return vec4u(0u); }
  return textureLoad(src, t, 0);
}

@compute @workgroup_size(16, 16)
fn horizontal(@builtin(global_invocation_id) g: vec3u) {
  if (i32(g.x) >= p.region.z || i32(g.y) >= p.region.w) { return; }
  let doc = p.region.xy + vec2i(g.xy);
  var acc = vec4u(0u);
  for (var k = -p.radius; k <= p.radius; k++) {
    acc += loadSrc(doc + vec2i(k, 0)) * weights[k + p.radius];
  }
  textureStore(dst, doc - p.outputOffset, (acc + vec4u(32768u)) >> vec4u(16u));
}

@compute @workgroup_size(16, 16)
fn vertical(@builtin(global_invocation_id) g: vec3u) {
  if (i32(g.x) >= p.region.z || i32(g.y) >= p.region.w) { return; }
  let doc = p.region.xy + vec2i(g.xy);
  var acc = vec4u(0u);
  for (var k = -p.radius; k <= p.radius; k++) {
    acc += loadSrc(doc + vec2i(0, k)) * weights[k + p.radius];
  }
  var result = (acc + vec4u(32768u)) >> vec4u(16u);
  if (p.useMask != 0u) {
    let mt = doc - p.maskOffset;
    var coverage = 0u;
    if (mt.x >= 0 && mt.y >= 0 && mt.x < p.maskSize.x && mt.y < p.maskSize.y) { coverage = textureLoad(mask, mt, 0).r; }
    let orig = textureLoad(original, doc - p.originalOffset, 0);
    result = (result * coverage + orig * (32768u - coverage) + vec4u(16384u)) >> vec4u(15u);
  }
  textureStore(dst, doc - p.outputOffset, result);
}
`;

/** Separable Gaussian blur with integer weights. The horizontal pass writes a temporary texture. */
export class GaussianBlurKernel implements FilterKernel {
  readonly type = 'gaussian-blur' as const;
  readonly #device: GPUDevice;
  readonly #layout: GPUBindGroupLayout;
  readonly #horizontal: GPUComputePipeline;
  readonly #vertical: GPUComputePipeline;
  readonly #dummyMask: GPUTexture;
  #temp: GPUTexture | null = null;

  constructor(device: GPUDevice) {
    this.#device = device;
    const module = device.createShaderModule({ label: 'gaussian blur', code: BLUR_WGSL });
    this.#layout = device.createBindGroupLayout({
      label: 'gaussian blur',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { format: 'rgba16uint', access: 'write-only' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.#layout] });
    this.#horizontal = device.createComputePipeline({ layout, compute: { module, entryPoint: 'horizontal' } });
    this.#vertical = device.createComputePipeline({ layout, compute: { module, entryPoint: 'vertical' } });
    this.#dummyMask = device.createTexture({ size: [1, 1], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING });
  }

  #tempTexture(width: number, height: number): GPUTexture {
    if (!this.#temp || this.#temp.width < width || this.#temp.height < height) {
      this.#temp?.destroy();
      this.#temp = this.#device.createTexture({
        label: 'blur temp',
        size: [Math.max(width, this.#temp?.width ?? 0), Math.max(height, this.#temp?.height ?? 0)],
        format: 'rgba16uint',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    return this.#temp;
  }

  encode(encoder: GPUCommandEncoder, args: FilterKernelArgs): void {
    const radius = (args.filter as { radius: number }).radius;
    const m = Math.ceil(radius);
    const weights = blurWeights(radius);
    const weightBuffer = this.#device.createBuffer({
      size: Math.max(weights.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(weightBuffer, 0, weights);
    args.transients.push(weightBuffer);

    // Rows above and below the output region feed the vertical pass.
    const r = args.region;
    const tempRegion = { x: r.x, y: Math.max(r.y - m, args.bounds.y), width: r.width, height: 0 };
    tempRegion.height = Math.min(r.y + r.height + m, args.bounds.y + args.bounds.height) - tempRegion.y;
    const temp = this.#tempTexture(tempRegion.width, tempRegion.height);
    const tempView = temp.createView();
    const maskView = args.mask?.view ?? this.#dummyMask.createView();

    const params = (
      region: Rect,
      inputOffset: readonly number[],
      inputSize: readonly number[],
      outputOffset: readonly number[],
      useMask: boolean,
    ) => {
      const data = new Int32Array(24);
      data.set([
        region.x,
        region.y,
        region.width,
        region.height,
        inputOffset[0]!,
        inputOffset[1]!,
        inputSize[0]!,
        inputSize[1]!,
      ]);
      data.set([outputOffset[0]!, outputOffset[1]!, args.mask?.offset[0] ?? 0, args.mask?.offset[1] ?? 0], 8);
      data.set([args.mask?.size[0] ?? 0, args.mask?.size[1] ?? 0, m, useMask ? 1 : 0], 12);
      data.set([args.bounds.x, args.bounds.y, args.bounds.width, args.bounds.height], 16);
      data.set([args.inputOffset[0], args.inputOffset[1]], 20);
      const buffer = this.#device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.#device.queue.writeBuffer(buffer, 0, data);
      args.transients.push(buffer);
      return buffer;
    };

    const run = (
      pipeline: GPUComputePipeline,
      src: GPUTextureView,
      dst: GPUTextureView,
      uniforms: GPUBuffer,
      region: Rect,
    ) => {
      const bindGroup = this.#device.createBindGroup({
        layout: this.#layout,
        entries: [
          { binding: 0, resource: src },
          { binding: 1, resource: dst },
          { binding: 2, resource: { buffer: weightBuffer } },
          { binding: 3, resource: { buffer: uniforms } },
          { binding: 4, resource: maskView },
          { binding: 5, resource: args.input },
        ],
      });
      const pass = encoder.beginComputePass({ label: 'gaussian blur' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(region.width / 16), Math.ceil(region.height / 16));
      pass.end();
    };

    const tempOffset = [tempRegion.x, tempRegion.y];
    run(
      this.#horizontal,
      args.input,
      tempView,
      params(tempRegion, args.inputOffset, args.inputSize, tempOffset, false),
      tempRegion,
    );
    run(
      this.#vertical,
      tempView,
      args.output,
      params(r, tempOffset, [tempRegion.width, tempRegion.height], args.outputOffset, args.mask !== null),
      r,
    );
  }

  dispose(): void {
    this.#temp?.destroy();
    this.#dummyMask.destroy();
  }
}
