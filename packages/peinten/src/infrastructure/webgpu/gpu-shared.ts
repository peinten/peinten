import { Compositor } from './compositor.ts';
import { type FilterKernel, FilterPass, GaussianBlurKernel } from './filter-pass.ts';
import { MipmapGenerator } from './mipmap.ts';
import { WarpPreviewRenderer } from './warp-preview.ts';

/** Pipelines and kernels shared by every document and view of a runtime. */
export class GpuShared {
  readonly device: GPUDevice;
  readonly compositor: Compositor;
  readonly filterPass: FilterPass;
  readonly warpPreview: WarpPreviewRenderer;
  readonly mipmaps: MipmapGenerator;

  constructor(device: GPUDevice, extraKernels: readonly FilterKernel[] = []) {
    this.device = device;
    this.compositor = new Compositor(device);
    this.filterPass = new FilterPass([new GaussianBlurKernel(device), ...extraKernels]);
    this.warpPreview = new WarpPreviewRenderer(device);
    this.mipmaps = new MipmapGenerator(device);
  }

  /** Submits recorded work and releases its transient buffers once the GPU is done with them. */
  submit(encoder: GPUCommandEncoder, transients: GPUBuffer[]): Promise<void> {
    this.device.queue.submit([encoder.finish()]);
    return this.device.queue.onSubmittedWorkDone().then(() => {
      for (const buffer of transients) buffer.destroy();
    });
  }

  dispose(): void {
    this.filterPass.dispose();
  }
}
