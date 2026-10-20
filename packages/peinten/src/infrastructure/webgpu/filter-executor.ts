import type { FilterRegistry, FilterSpec } from '../../domain/filters/filter.ts';
import type { FilterExecutor } from '../../domain/ops/context.ts';
import { OperationConflictError } from '../../domain/ops/operation.ts';
import {
  isEmptyTile,
  RGBA_TILE_LENGTH,
  TILE_SIZE,
  type TileKey,
  tileCoords,
  tileKey,
} from '../../domain/tiles/tile.ts';
import { forEachTileInRect, inflateRect, type MaskMap, type Rect, type TileMap } from '../../domain/tiles/tile-map.ts';
import type { GpuShared } from './gpu-shared.ts';
import { readTexture } from './readback.ts';

function alignToTiles(rect: Rect): Rect {
  const x0 = Math.floor(rect.x / TILE_SIZE) * TILE_SIZE;
  const y0 = Math.floor(rect.y / TILE_SIZE) * TILE_SIZE;
  const x1 = Math.ceil((rect.x + rect.width) / TILE_SIZE) * TILE_SIZE;
  const y1 = Math.ceil((rect.y + rect.height) / TILE_SIZE) * TILE_SIZE;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Puts the original pixels back wherever the filter must not change anything: outside the region and, with a
 * selection, where the coverage is zero. Kernels blend by coverage themselves; this keeps a kernel that ignores the
 * mask from changing pixels outside the selection.
 */
function protect(
  tile: Uint16Array,
  original: Uint16Array | undefined,
  key: TileKey,
  region: Rect,
  mask: MaskMap | null,
) {
  const [tx, ty] = tileCoords(key);
  const coverage = mask?.get(key);
  for (let y = 0; y < TILE_SIZE; y++) {
    const docY = ty * TILE_SIZE + y;
    const rowInside = docY >= region.y && docY < region.y + region.height;
    for (let x = 0; x < TILE_SIZE; x++) {
      const docX = tx * TILE_SIZE + x;
      const inside =
        rowInside &&
        docX >= region.x &&
        docX < region.x + region.width &&
        (!mask || (coverage !== undefined && coverage[y * TILE_SIZE + x]! > 0));
      if (inside) continue;
      const p = (y * TILE_SIZE + x) * 4;
      if (original) tile.set(original.subarray(p, p + 4), p);
      else tile.fill(0, p, p + 4);
    }
  }
}

/**
 * Destructive filtering on the GPU. Tiles are uploaded into tile-aligned textures, the shared FilterPass runs,
 * and the result comes back as tiles. Pixels outside the region keep their original values.
 */
export class GpuFilterExecutor implements FilterExecutor {
  readonly #gpu: GpuShared;
  readonly #filters: FilterRegistry;

  constructor(gpu: GpuShared, filters: FilterRegistry) {
    this.#gpu = gpu;
    this.#filters = filters;
  }

  async apply(input: {
    tiles: TileMap;
    region: Rect;
    bounds: Rect;
    filter: FilterSpec;
    mask: MaskMap | null;
  }): Promise<TileMap> {
    const device = this.#gpu.device;
    const margin = this.#filters.margin(input.filter);
    const inputRect = alignToTiles(inflateRect(input.region, margin));
    const outputRect = alignToTiles(input.region);

    const upload = (
      texture: GPUTexture,
      rect: Rect,
      tiles: ReadonlyMap<TileKey, Uint16Array>,
      bytesPerPixel: number,
    ) => {
      forEachTileInRect(rect, (tx, ty) => {
        const tile = tiles.get(tileKey(tx, ty));
        if (!tile) return;
        device.queue.writeTexture(
          { texture, origin: { x: tx * TILE_SIZE - rect.x, y: ty * TILE_SIZE - rect.y } },
          tile as GPUAllowSharedBufferSource,
          { bytesPerRow: TILE_SIZE * bytesPerPixel, rowsPerImage: TILE_SIZE },
          { width: TILE_SIZE, height: TILE_SIZE },
        );
      });
    };

    const source = device.createTexture({
      size: [inputRect.width, inputRect.height],
      format: 'rgba16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    upload(source, inputRect, input.tiles, 8);
    const output = device.createTexture({
      size: [outputRect.width, outputRect.height],
      format: 'rgba16uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    let maskTexture: GPUTexture | null = null;
    if (input.mask) {
      maskTexture = device.createTexture({
        size: [inputRect.width, inputRect.height],
        format: 'r16uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      upload(maskTexture, inputRect, input.mask, 2);
    }

    // A WGSL or validation error invalidates the whole command buffer and leaves the output zeroed, so it must not
    // be read back as a result.
    device.pushErrorScope('validation');
    const transients: GPUBuffer[] = [];
    let submitted: Promise<void> | null = null;
    let thrown: unknown = null;
    try {
      const encoder = device.createCommandEncoder({ label: 'apply filter' });
      // Start from the original pixels so the parts of the output tiles outside the region stay untouched.
      encoder.copyTextureToTexture(
        { texture: source, origin: { x: outputRect.x - inputRect.x, y: outputRect.y - inputRect.y } },
        { texture: output },
        { width: outputRect.width, height: outputRect.height },
      );
      this.#gpu.filterPass.encode(encoder, {
        filter: input.filter,
        input: source.createView(),
        inputOffset: [inputRect.x, inputRect.y],
        inputSize: [inputRect.width, inputRect.height],
        output: output.createView(),
        outputOffset: [outputRect.x, outputRect.y],
        region: input.region,
        bounds: input.bounds,
        mask: maskTexture
          ? {
              view: maskTexture.createView(),
              offset: [inputRect.x, inputRect.y],
              size: [inputRect.width, inputRect.height],
            }
          : null,
        transients,
      });
      submitted = this.#gpu.submit(encoder, transients);
    } catch (error) {
      thrown = error;
    }
    const failure = await device.popErrorScope();
    if (!submitted || failure) {
      for (const buffer of transients) buffer.destroy();
      for (const texture of [source, output, maskTexture]) texture?.destroy();
      const reason = failure?.message ?? (thrown as Error).message;
      throw new OperationConflictError(`Filter ${input.filter.type} failed on the GPU: ${reason}`);
    }
    await submitted;
    const bytes = await readTexture(device, output, 8, outputRect.width, outputRect.height);
    source.destroy();
    output.destroy();
    maskTexture?.destroy();

    const values = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const result = new Map(input.tiles);
    forEachTileInRect(outputRect, (tx, ty) => {
      const tile = new Uint16Array(RGBA_TILE_LENGTH);
      const ox = tx * TILE_SIZE - outputRect.x;
      const oy = ty * TILE_SIZE - outputRect.y;
      for (let y = 0; y < TILE_SIZE; y++) {
        const start = ((oy + y) * outputRect.width + ox) * 4;
        tile.set(values.subarray(start, start + TILE_SIZE * 4), y * TILE_SIZE * 4);
      }
      const key = tileKey(tx, ty);
      protect(tile, input.tiles.get(key), key, input.region, input.mask);
      if (isEmptyTile(tile)) result.delete(key);
      else result.set(key, tile);
    });
    return result;
  }
}
