import type { DocumentRenderCache, RenderBackend, ViewSurface } from '../../application/ports/renderer.ts';
import type { FilterRegistry } from '../../domain/filters/filter.ts';
import type { FilterExecutor } from '../../domain/ops/context.ts';
import { DocumentGpuCache } from './document-cache.ts';
import { GpuFilterExecutor } from './filter-executor.ts';
import type { FilterKernel } from './filter-pass.ts';
import { GpuShared } from './gpu-shared.ts';
import { WebGpuViewSurface } from './view-surface.ts';

/** Largest document edge. Bounded so a full recomposite fits in one dispatch and memory stays reasonable. */
const MAX_DOCUMENT_SIZE = 8192;

/** WebGPU implementation of the renderer port. */
export class WebGpuBackend implements RenderBackend {
  readonly #shared: GpuShared;
  readonly #filters: FilterRegistry;
  readonly #canvasFormat: GPUTextureFormat;
  readonly filterExecutor: FilterExecutor;
  readonly maxDocumentSize: number;

  private constructor(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    filters: FilterRegistry,
    kernels: readonly FilterKernel[],
  ) {
    this.#shared = new GpuShared(device, kernels);
    this.#filters = filters;
    this.#canvasFormat = canvasFormat;
    this.filterExecutor = new GpuFilterExecutor(this.#shared, filters);
    this.maxDocumentSize = Math.min(MAX_DOCUMENT_SIZE, device.limits.maxTextureDimension2D);
  }

  /** Acquires a device from `gpu` (navigator.gpu by default). Throws when WebGPU is unavailable. */
  static async create(options: {
    gpu?: GPU | undefined;
    filters: FilterRegistry;
    createKernels?: (device: GPUDevice) => readonly FilterKernel[];
  }): Promise<WebGpuBackend> {
    const gpu = options.gpu ?? (globalThis.navigator as Navigator | undefined)?.gpu;
    if (!gpu) throw new Error('WebGPU is not supported in this environment');
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter is available');
    const device = await adapter.requestDevice({
      requiredLimits: { maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers },
    });
    const format = typeof gpu.getPreferredCanvasFormat === 'function' ? gpu.getPreferredCanvasFormat() : 'bgra8unorm';
    return new WebGpuBackend(device, format, options.filters, options.createKernels?.(device) ?? []);
  }

  createDocumentCache(width: number, height: number): DocumentRenderCache {
    if (width > this.maxDocumentSize || height > this.maxDocumentSize) {
      throw new Error(`Documents are limited to ${this.maxDocumentSize}px per side`);
    }
    return new DocumentGpuCache(this.#shared, this.#filters, width, height);
  }

  createViewSurface(canvas: OffscreenCanvas | HTMLCanvasElement, cache: DocumentRenderCache): ViewSurface {
    return new WebGpuViewSurface(this.#shared.device, this.#canvasFormat, canvas, cache as DocumentGpuCache);
  }

  dispose(): void {
    this.#shared.dispose();
    this.#shared.device.destroy();
  }
}
