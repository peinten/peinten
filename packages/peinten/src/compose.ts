import type { TextEngine } from './application/ports/text.ts';
import { LocalRuntime } from './application/runtime.ts';
import type { AnyTool } from './application/tool.ts';
import { type ColorMixer, libMyPaintPigmentMixer } from './domain/brush/color-mixer.ts';
import { type FilterDefinition, FilterRegistry, type FilterType, gaussianBlurFilter } from './domain/filters/filter.ts';
import { coreOperations } from './domain/ops/core.ts';
import { newId } from './domain/ops/ids.ts';
import type { AnyOperationDefinition } from './domain/ops/operation.ts';
import { OperationRegistry, registryHash } from './domain/ops/registry.ts';
import { cborDocumentCodec } from './infrastructure/encoders/cbor-document-codec.ts';
import { animationFrameScheduler, imageBitmapThumbnails } from './infrastructure/platform.ts';
import { CanvasTextEngine } from './infrastructure/text-canvas/canvas-text-engine.ts';
import { WebGpuBackend } from './infrastructure/webgpu/backend.ts';
import type { FilterKernel } from './infrastructure/webgpu/filter-pass.ts';

/** A filter registration: the device-independent definition plus a factory for its GPU kernel. */
export interface CustomFilter<K extends FilterType = FilterType> {
  readonly definition: FilterDefinition<K>;
  readonly createKernel: (device: GPUDevice) => FilterKernel;
}

/** Registers a filter for both the domain (validation, margins) and the GPU (kernel). */
export function defineFilter<K extends FilterType>(
  filter: FilterDefinition<K> & { readonly createKernel: (device: GPUDevice) => FilterKernel },
): CustomFilter<K> {
  const { createKernel, ...definition } = filter;
  return { definition: definition as FilterDefinition<K>, createKernel };
}

export interface RuntimeOptions<T extends readonly AnyTool[]> {
  readonly tools: T;
  /** WebGPU entry point; defaults to `navigator.gpu`. */
  readonly gpu?: GPU;
  /** Pigment mixing for brushes; defaults to libmypaint 2.0's spectral mixer. Peers must agree. */
  readonly colorMixer?: ColorMixer;
  /** Text layout and rendering; defaults to Canvas2D. */
  readonly textEngine?: TextEngine;
  readonly operations?: readonly AnyOperationDefinition[];
  readonly filters?: readonly CustomFilter[];
  readonly clientId?: string;
  readonly onError?: (error: unknown) => void;
}

/** Builds a LocalRuntime with the default infrastructure. Shared by the main-thread and worker entry points. */
export async function composeRuntime<T extends readonly AnyTool[]>(
  options: RuntimeOptions<T>,
): Promise<LocalRuntime<T>> {
  const mixer = options.colorMixer ?? libMyPaintPigmentMixer;
  if (mixer.latentSize > 64) throw new Error('Color mixers may use at most 64 latent dimensions');
  const filters = new FilterRegistry([
    gaussianBlurFilter,
    ...(options.filters ?? []).map((f) => f.definition as FilterDefinition),
  ]);
  const operations = new OperationRegistry([...coreOperations, ...(options.operations ?? [])]);
  const backend = await WebGpuBackend.create({
    gpu: options.gpu,
    filters,
    createKernels: (device) => (options.filters ?? []).map((f) => f.createKernel(device)),
  });
  return new LocalRuntime(
    {
      backend,
      scheduler: animationFrameScheduler,
      thumbnails: imageBitmapThumbnails,
      textEngine: options.textEngine ?? new CanvasTextEngine(),
      codec: cborDocumentCodec,
      registryHash: registryHash([...operations.types(), ...filters.types(), mixer.id]),
      mixer,
      registry: operations,
      filters,
      clientId: options.clientId ?? newId(),
      onError: options.onError ?? ((error) => console.error('[peinten]', error)),
    },
    options.tools,
  );
}
