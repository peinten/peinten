import { TILE_SIZE } from '../../domain/tiles/tile.ts';

/** Tiles per row and column of one atlas page. */
export const PAGE_TILES = 32;
const PAGE_SIZE = PAGE_TILES * TILE_SIZE;
const SLOTS_PER_PAGE = PAGE_TILES * PAGE_TILES;

/**
 * GPU storage for fix15 tiles: a texture array whose layers are pages of 32x32 tiles.
 * Tile data is uploaded without conversion. The texture grows by doubling its page count.
 */
export class TileAtlas {
  readonly #device: GPUDevice;
  readonly #format: 'rgba16uint' | 'r16uint';
  readonly #bytesPerPixel: number;
  #texture: GPUTexture;
  #pages: number;
  readonly #free: number[] = [];
  #next = 0;

  constructor(device: GPUDevice, format: 'rgba16uint' | 'r16uint', initialPages = 2) {
    this.#device = device;
    this.#format = format;
    this.#bytesPerPixel = format === 'rgba16uint' ? 8 : 2;
    this.#pages = initialPages;
    this.#texture = this.#create(initialPages);
  }

  #create(pages: number): GPUTexture {
    return this.#device.createTexture({
      label: `tile atlas (${this.#format})`,
      size: { width: PAGE_SIZE, height: PAGE_SIZE, depthOrArrayLayers: pages },
      format: this.#format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
  }

  get texture(): GPUTexture {
    return this.#texture;
  }

  allocate(): number {
    const reused = this.#free.pop();
    if (reused !== undefined) return reused;
    const slot = this.#next++;
    if (slot >= this.#pages * SLOTS_PER_PAGE) this.#grow();
    return slot;
  }

  release(slot: number): void {
    this.#free.push(slot);
  }

  #grow(): void {
    const pages = this.#pages * 2;
    const limit = this.#device.limits.maxTextureArrayLayers;
    if (pages > limit) throw new Error('Tile atlas exceeded the GPU texture array limit');
    const texture = this.#create(pages);
    const encoder = this.#device.createCommandEncoder();
    encoder.copyTextureToTexture(
      { texture: this.#texture },
      { texture },
      { width: PAGE_SIZE, height: PAGE_SIZE, depthOrArrayLayers: this.#pages },
    );
    this.#device.queue.submit([encoder.finish()]);
    this.#texture.destroy();
    this.#texture = texture;
    this.#pages = pages;
  }

  upload(slot: number, data: Uint16Array): void {
    const page = Math.floor(slot / SLOTS_PER_PAGE);
    const index = slot % SLOTS_PER_PAGE;
    this.#device.queue.writeTexture(
      {
        texture: this.#texture,
        origin: { x: (index % PAGE_TILES) * TILE_SIZE, y: Math.floor(index / PAGE_TILES) * TILE_SIZE, z: page },
      },
      data as GPUAllowSharedBufferSource,
      { bytesPerRow: TILE_SIZE * this.#bytesPerPixel, rowsPerImage: TILE_SIZE },
      { width: TILE_SIZE, height: TILE_SIZE },
    );
  }

  dispose(): void {
    this.#texture.destroy();
  }
}
