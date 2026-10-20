import { OVERLAY_VERTEX_FLOATS, type OverlayGeometry } from '../../application/overlay.ts';
import type { ViewBackground, ViewSurface } from '../../application/ports/renderer.ts';
import { type CanvasSize, screenToDocument, type Viewport } from '../../application/viewport.ts';
import type { DocumentGpuCache } from './document-cache.ts';

const DISPLAY_WGSL = /* wgsl */ `
struct View {
  inv0: vec4f,
  inv1: vec4f,
  docSize: vec2f,
  zoom: f32,
  time: f32,
  background: vec4f,
  mode: u32,
  quickMask: u32,
  hasSelection: u32,
  dpr: f32,
  selectionOffset: vec2f,
}

@group(0) @binding(0) var composite: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var selection: texture_2d<u32>;
@group(0) @binding(3) var<uniform> view: View;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn toDoc(s: vec2f) -> vec2f {
  return vec2f(view.inv0.x * s.x + view.inv0.z * s.y + view.inv1.x, view.inv0.y * s.x + view.inv0.w * s.y + view.inv1.y);
}

fn coverage(doc: vec2f) -> f32 {
  let p = vec2i(floor(doc - view.selectionOffset));
  let size = vec2i(view.docSize);
  if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) { return 0.0; }
  return f32(textureLoad(selection, p, 0).r) / 32768.0;
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let doc = toDoc(pos.xy);
  // The checkerboard lives in document space so it pans, zooms and rotates with the canvas. Cells double when zoomed
  // out so they never shrink below 8 CSS pixels, where they would shimmer.
  let cell = 8.0 * exp2(max(0.0, ceil(log2(view.dpr / view.zoom))));
  let cellIndex = vec2i(floor(doc / cell));
  let check = (cellIndex.x + cellIndex.y) & 1;
  var bg = vec4f(0.0);
  if (view.mode == 0u) { bg = select(vec4f(1.0, 1.0, 1.0, 1.0), vec4f(0.8, 0.8, 0.8, 1.0), check == 1); }
  if (view.mode == 2u) { bg = view.background; }
  if (doc.x < 0.0 || doc.y < 0.0 || doc.x >= view.docSize.x || doc.y >= view.docSize.y) {
    if (view.mode == 1u) { return vec4f(0.0); }
    return vec4f(0.16, 0.16, 0.18, 1.0);
  }
  var c: vec4f;
  if (view.zoom >= 2.0) {
    c = textureLoad(composite, vec2i(floor(doc)), 0);
  } else {
    c = textureSampleLevel(composite, linearSampler, doc / view.docSize, max(0.0, log2(1.0 / view.zoom)));
  }
  var color = c + bg * (1.0 - c.a);
  if (view.quickMask != 0u) {
    let m = coverage(doc);
    color = mix(color, vec4f(0.85, 0.1, 0.15, 1.0), 0.5 * (1.0 - m));
  } else if (view.hasSelection != 0u) {
    let inside = coverage(doc) >= 0.5;
    let step = 1.0 / view.zoom;
    let border = inside != (coverage(doc + vec2f(step, 0.0)) >= 0.5) || inside != (coverage(doc + vec2f(0.0, step)) >= 0.5)
      || inside != (coverage(doc - vec2f(step, 0.0)) >= 0.5) || inside != (coverage(doc - vec2f(0.0, step)) >= 0.5);
    if (border) {
      let dash = fract((pos.x + pos.y) / (8.0 * view.dpr) - view.time * 2.0) < 0.5;
      color = select(vec4f(0.0, 0.0, 0.0, 1.0), vec4f(1.0), dash);
    }
  }
  return color;
}

struct OverlayOut { @builtin(position) pos: vec4f, @location(0) color: vec4f, @location(1) dash: f32 }

@vertex
fn overlayVs(@location(0) p: vec2f, @location(1) color: vec4f, @location(2) dash: f32) -> OverlayOut {
  var out: OverlayOut;
  let size = view.inv1.zw;
  out.pos = vec4f(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
  out.color = color;
  out.dash = dash;
  return out;
}

@fragment
fn overlayFs(in: OverlayOut) -> @location(0) vec4f {
  var c = in.color;
  if (in.dash >= 0.0 && fract(in.dash / (6.0 * view.dpr) - view.time) >= 0.5) { c = vec4f(0.0, 0.0, 0.0, c.a); }
  return vec4f(c.rgb * c.a, c.a);
}
`;

/** A canvas showing one document: the composite under the viewport transform, selection feedback and tool overlays. */
export class WebGpuViewSurface implements ViewSurface {
  readonly #device: GPUDevice;
  readonly #canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly #context: GPUCanvasContext;
  readonly #cache: DocumentGpuCache;
  readonly #display: GPURenderPipeline;
  readonly #overlay: GPURenderPipeline;
  readonly #uniforms: GPUBuffer;
  readonly #sampler: GPUSampler;
  readonly #layout: GPUBindGroupLayout;
  #bindGroup: GPUBindGroup;
  /** The cache's texture generation that `#bindGroup` refers to. */
  #boundGeneration: number;
  #size: CanvasSize = { width: 1, height: 1, devicePixelRatio: 1 };

  constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    canvas: OffscreenCanvas | HTMLCanvasElement,
    cache: DocumentGpuCache,
  ) {
    this.#device = device;
    this.#canvas = canvas;
    this.#cache = cache;
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error('WebGPU canvas context is unavailable');
    this.#context = context;
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const module = device.createShaderModule({ label: 'display', code: DISPLAY_WGSL });
    this.#layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.#layout] });
    this.#display = device.createRenderPipeline({
      label: 'display',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    });
    this.#overlay = device.createRenderPipeline({
      label: 'overlay',
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: 'overlayVs',
        buffers: [
          {
            arrayStride: OVERLAY_VERTEX_FLOATS * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x4' },
              { shaderLocation: 2, offset: 24, format: 'float32' },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'overlayFs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
    });
    this.#uniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.#sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    this.#bindGroup = this.#createBindGroup();
    this.#boundGeneration = cache.textureGeneration;
  }

  #createBindGroup(): GPUBindGroup {
    return this.#device.createBindGroup({
      layout: this.#layout,
      entries: [
        { binding: 0, resource: this.#cache.composite.createView() },
        { binding: 1, resource: this.#sampler },
        { binding: 2, resource: this.#cache.selection.createView() },
        { binding: 3, resource: { buffer: this.#uniforms } },
      ],
    });
  }

  resize(size: CanvasSize): void {
    this.#size = size;
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;
  }

  render(viewport: Viewport, overlay: OverlayGeometry, background: ViewBackground, time: number): void {
    const size = this.#size;
    const inv = screenToDocument(viewport, size);
    const data = new ArrayBuffer(96);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    f.set([
      inv[0],
      inv[1],
      inv[2],
      inv[3],
      inv[4],
      inv[5],
      size.width,
      size.height,
      this.#cache.width,
      this.#cache.height,
      viewport.zoom,
      time,
    ]);
    if (Array.isArray(background)) f.set([background[0], background[1], background[2], 1], 12);
    u[16] = background === 'checker' ? 0 : background === 'transparent' ? 1 : 2;
    u[17] = this.#cache.quickMask ? 1 : 0;
    u[18] = this.#cache.hasSelection ? 1 : 0;
    f[19] = size.devicePixelRatio;
    const offset = this.#cache.selectionOffset;
    f[20] = offset?.x ?? 0;
    f[21] = offset?.y ?? 0;
    this.#device.queue.writeBuffer(this.#uniforms, 0, data);

    const encoder = this.#device.createCommandEncoder({ label: 'view' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(this.#display);
    if (this.#boundGeneration !== this.#cache.textureGeneration) {
      this.#bindGroup = this.#createBindGroup();
      this.#boundGeneration = this.#cache.textureGeneration;
    }
    pass.setBindGroup(0, this.#bindGroup);
    pass.draw(3);
    let vertexBuffer: GPUBuffer | null = null;
    if (overlay.vertices.length) {
      vertexBuffer = this.#device.createBuffer({
        size: overlay.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.#device.queue.writeBuffer(vertexBuffer, 0, overlay.vertices as GPUAllowSharedBufferSource);
      pass.setPipeline(this.#overlay);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(overlay.vertices.length / OVERLAY_VERTEX_FLOATS);
    }
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
    if (vertexBuffer) {
      const buffer = vertexBuffer;
      this.#device.queue.onSubmittedWorkDone().then(() => buffer.destroy());
    }
  }

  /**
   * Leaves the canvas context configured: a later view on the same canvas reconfigures it, and unconfiguring here
   * could race with that view when disposal arrives late (React StrictMode mounts views twice).
   */
  dispose(): void {
    this.#uniforms.destroy();
  }
}
