import type { DirtyHint, DocumentRenderCache, RenderSource } from '../../application/ports/renderer.ts';
import type { NodeId } from '../../domain/document/nodes.ts';
import type { FilterRegistry } from '../../domain/filters/filter.ts';
import { MASK_TILE_LENGTH, TILE_SIZE, type TileKey, tileCoords, tileKey } from '../../domain/tiles/tile.ts';
import { inflateRect, intersectRect, type Rect, type TileMap, unionRect } from '../../domain/tiles/tile-map.ts';
import { type CompositePlan, type PlanStep, type ProgramItem, planComposite } from './composite-plan.ts';
import { EMPTY_SLOT, OP } from './compositor.ts';
import type { GpuShared } from './gpu-shared.ts';
import { halfPremultipliedToRgba8, readTexture } from './readback.ts';
import { TileAtlas } from './tile-atlas.ts';

interface SlotEntry {
  tile: Uint16Array;
  slot: number;
}

type LiveLayers = readonly ReadonlyMap<TileKey, Uint16Array>[];

interface SourceRecord {
  committed: TileMap;
  live: LiveLayers;
  entries: Map<TileKey, SlotEntry>;
}

function sameLayers(a: LiveLayers, b: LiveLayers): boolean {
  return a.length === b.length && a.every((tiles, i) => tiles === b[i]);
}

const ZERO_MASK = new Uint16Array(MASK_TILE_LENGTH);
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const floatBits = (value: number) => {
  f32[0] = value;
  return u32[0]!;
};

/**
 * GPU caches of one document, encapsulated so several documents (for example a brush preview) never share state.
 * Owns the tile atlas, the composite with its mips, the selection texture and the intermediates of adjustment
 * layers and previews.
 */
export class DocumentGpuCache implements DocumentRenderCache {
  readonly #gpu: GpuShared;
  readonly #filters: FilterRegistry;
  #width: number;
  #height: number;
  readonly #atlas: TileAtlas;
  #composite: GPUTexture;
  #selection: GPUTexture;
  readonly #dummyUint: GPUTexture;
  readonly #dummyArray: GPUTexture;
  #results: GPUTexture | null = null;
  #scratch: GPUTexture | null = null;
  #filterOut: GPUTexture | null = null;
  #warped: GPUTexture | null = null;

  readonly #sources = new Map<NodeId, SourceRecord>();
  readonly #selectionTiles = new Map<TileKey, Uint16Array>();
  #lastSelection: TileMap<Uint16Array> | null = null;
  #lastLiveSelection: ReadonlyMap<TileKey, Uint16Array> | null = null;
  #structureKey = '';
  #plan: CompositePlan | null = null;
  #source: RenderSource | null = null;
  /** Incremented after every composite so views know when to redraw. */
  version = 0;
  /** Incremented when the canvas size changes and the composite and selection textures are replaced. */
  textureGeneration = 0;

  constructor(gpu: GpuShared, filters: FilterRegistry, width: number, height: number) {
    this.#gpu = gpu;
    this.#filters = filters;
    this.#width = width;
    this.#height = height;
    const device = gpu.device;
    this.#atlas = new TileAtlas(device, 'rgba16uint');
    [this.#composite, this.#selection] = this.#createCanvasTextures();
    this.#dummyUint = device.createTexture({
      size: [1, 1],
      format: 'rgba16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#dummyArray = device.createTexture({
      size: [1, 1, 1],
      format: 'rgba16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get composite(): GPUTexture {
    return this.#composite;
  }

  get selection(): GPUTexture {
    return this.#selection;
  }

  #createCanvasTextures(): [composite: GPUTexture, selection: GPUTexture] {
    const device = this.#gpu.device;
    const size = [this.#width, this.#height];
    return [
      device.createTexture({
        label: 'composite',
        size,
        format: 'rgba16float',
        mipLevelCount: Math.floor(Math.log2(Math.max(this.#width, this.#height))) + 1,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      }),
      device.createTexture({
        label: 'selection',
        size,
        format: 'r16uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
    ];
  }

  /**
   * Replaces every texture sized like the canvas. Tiles in the atlas do not depend on the size and stay; the
   * selection is uploaded again and the next composite covers the whole canvas.
   */
  #resize(width: number, height: number): void {
    for (const texture of [
      this.#composite,
      this.#selection,
      this.#results,
      this.#scratch,
      this.#filterOut,
      this.#warped,
    ])
      texture?.destroy();
    this.#results = this.#scratch = this.#filterOut = this.#warped = null;
    this.#width = width;
    this.#height = height;
    [this.#composite, this.#selection] = this.#createCanvasTextures();
    this.#selectionTiles.clear();
    this.#lastSelection = null;
    this.#lastLiveSelection = null;
    this.#plan = null;
    this.textureGeneration++;
  }

  get #docRect(): Rect {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  #docTexture(label: string, usage: number): GPUTexture {
    return this.#gpu.device.createTexture({ label, size: [this.width, this.height], format: 'rgba16uint', usage });
  }

  #ensureIntermediates(stageLayers: number, warp: boolean): void {
    const device = this.#gpu.device;
    if (stageLayers > 0 && (this.#results?.depthOrArrayLayers ?? 0) < stageLayers) {
      this.#results?.destroy();
      this.#results = device.createTexture({
        label: 'composite stages',
        size: [this.width, this.height, stageLayers],
        format: 'rgba16uint',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    if (stageLayers > 0) {
      this.#scratch ??= this.#docTexture(
        'composite scratch',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      );
      this.#filterOut ??= this.#docTexture(
        'filter output',
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      );
    }
    if (warp) {
      this.#warped ??= this.#docTexture(
        'warp preview',
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      );
    }
  }

  /** Uploads changed tiles of one node. Returns the bounds of the tiles that changed. */
  #syncSource(nodeId: NodeId, committed: TileMap, live: LiveLayers, liveKeys: readonly TileKey[]): Rect | null {
    let record = this.#sources.get(nodeId);
    if (!record) {
      record = { committed: new Map(), live: [], entries: new Map() };
      this.#sources.set(nodeId, record);
    }
    let dirty: Rect | null = null;
    const mark = (key: TileKey) => {
      const [tx, ty] = tileCoords(key);
      dirty = unionRect(dirty, { x: tx * TILE_SIZE, y: ty * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE });
    };
    const put = (key: TileKey, tile: Uint16Array | undefined, force: boolean) => {
      const entry = record.entries.get(key);
      if (!tile) {
        if (!entry) return;
        this.#atlas.release(entry.slot);
        record.entries.delete(key);
        mark(key);
        return;
      }
      if (entry && entry.tile === tile && !force) return;
      const slot = entry?.slot ?? this.#atlas.allocate();
      this.#atlas.upload(slot, tile);
      record.entries.set(key, { tile, slot });
      mark(key);
    };
    const effective = (key: TileKey) => {
      for (const tiles of live) {
        const tile = tiles.get(key);
        if (tile) return tile;
      }
      return committed.get(key);
    };
    if (record.committed !== committed || !sameLayers(record.live, live)) {
      for (const key of committed.keys()) put(key, effective(key), false);
      for (const tiles of live)
        for (const key of tiles.keys()) if (!committed.has(key)) put(key, effective(key), false);
      for (const key of [...record.entries.keys()])
        if (!committed.has(key) && !live.some((tiles) => tiles.has(key))) put(key, undefined, false);
      record.committed = committed;
      record.live = live;
    }
    for (const key of liveKeys) put(key, effective(key), true);
    return dirty;
  }

  #syncSelection(source: RenderSource, hint: DirtyHint): void {
    const selection = source.selection;
    const live = source.liveSelection;
    const effective = (key: TileKey) => live?.get(key) ?? selection?.get(key);
    const upload = (key: TileKey) => {
      const tile = effective(key) ?? ZERO_MASK;
      if (this.#selectionTiles.get(key) === tile && !hint.liveSelectionKeys.includes(key)) return;
      const [tx, ty] = tileCoords(key);
      const x = tx * TILE_SIZE;
      const y = ty * TILE_SIZE;
      const width = Math.min(TILE_SIZE, this.width - x);
      const height = Math.min(TILE_SIZE, this.height - y);
      if (width <= 0 || height <= 0) return;
      this.#gpu.device.queue.writeTexture(
        { texture: this.selection, origin: { x, y } },
        tile as GPUAllowSharedBufferSource,
        { bytesPerRow: TILE_SIZE * 2, rowsPerImage: TILE_SIZE },
        { width, height },
      );
      if (tile === ZERO_MASK) this.#selectionTiles.delete(key);
      else this.#selectionTiles.set(key, tile);
    };
    if (selection !== this.#lastSelection || live !== this.#lastLiveSelection) {
      const keys = new Set<TileKey>([
        ...this.#selectionTiles.keys(),
        ...(selection?.keys() ?? []),
        ...(live?.keys() ?? []),
      ]);
      for (const key of keys) upload(key);
      this.#lastSelection = selection;
      this.#lastLiveSelection = live;
    }
    for (const key of hint.liveSelectionKeys) upload(key);
  }

  /** Everything that forces a full recomposite when it changes: tree shape, node properties and previews. */
  #computeStructureKey(source: RenderSource): string {
    const nodes = [...source.state.nodes.values()].map((node) =>
      Object.entries(node).filter(([name]) => name !== 'tiles'),
    );
    return JSON.stringify([
      source.state.rootIds,
      nodes,
      source.warpPreview,
      source.filterPreview,
      source.selection !== null && (source.warpPreview !== null || source.filterPreview !== null)
        ? source.selection.size
        : 0,
    ]);
  }

  sync(source: RenderSource, hint: DirtyHint): void {
    this.#source = source;
    const state = source.state;
    if (state.width !== this.#width || state.height !== this.#height) this.#resize(state.width, state.height);
    let dirty: Rect | null = null;

    // Pixel sources: paint layers (with the live stroke on top) and rendered text.
    const seen = new Set<NodeId>();
    for (const node of state.nodes.values()) {
      if (node.kind !== 'paint' && node.kind !== 'text') continue;
      seen.add(node.id);
      const committed = node.kind === 'paint' ? node.tiles : (source.textRasters.get(node.id) ?? new Map());
      const live = source.live.filter((entry) => entry.nodeId === node.id).map((entry) => entry.tiles);
      dirty = unionRect(dirty, this.#syncSource(node.id, committed, live, hint.liveKeys.get(node.id) ?? []));
    }
    for (const [id, record] of this.#sources) {
      if (seen.has(id)) continue;
      for (const entry of record.entries.values()) this.#atlas.release(entry.slot);
      this.#sources.delete(id);
    }
    this.#syncSelection(source, hint);

    const key = this.#computeStructureKey(source);
    if (key !== this.#structureKey || !this.#plan) {
      this.#structureKey = key;
      this.#plan = planComposite(state, state.rootIds, {
        filters: this.#filters,
        warpNodeId: source.warpPreview?.nodeId ?? null,
        filterPreview: source.filterPreview,
      });
      dirty = this.#docRect;
    }
    if (!dirty) return;
    this.#render(this.#plan, dirty, 'final');
  }

  /** Runs the plan over the dirty rectangle (grown by every filter margin) and refreshes the mips. */
  #render(plan: CompositePlan, dirtyRect: Rect, target: 'final' | GPUTexture): void {
    const region = intersectRect(inflateRect(dirtyRect, plan.margin), this.#docRect);
    if (!region) return;
    const source = this.#source!;
    const gpu = this.#gpu;
    const device = gpu.device;
    this.#ensureIntermediates(plan.stageLayers, source.warpPreview !== null);
    const encoder = device.createCommandEncoder({ label: 'composite' });
    const transients: GPUBuffer[] = [];

    // Snap to whole tiles: every step recomputes the same rectangular tile set.
    const tx0 = Math.floor(region.x / TILE_SIZE);
    const ty0 = Math.floor(region.y / TILE_SIZE);
    const tx1 = Math.floor((region.x + region.width - 1) / TILE_SIZE);
    const ty1 = Math.floor((region.y + region.height - 1) / TILE_SIZE);
    const tileRect = intersectRect(
      {
        x: tx0 * TILE_SIZE,
        y: ty0 * TILE_SIZE,
        width: (tx1 - tx0 + 1) * TILE_SIZE,
        height: (ty1 - ty0 + 1) * TILE_SIZE,
      },
      this.#docRect,
    )!;

    const warp = source.warpPreview;
    if (warp) this.#encodeWarpPreview(encoder, warp, transients);

    for (const step of plan.steps) this.#encodeStep(encoder, step, tx0, ty0, tx1, ty1, tileRect, target, transients);
    if (target === 'final') gpu.mipmaps.encode(encoder, this.composite, tileRect, transients);
    gpu.submit(encoder, transients);
    this.version++;
  }

  #encodeWarpPreview(
    encoder: GPUCommandEncoder,
    warp: NonNullable<RenderSource['warpPreview']>,
    transients: GPUBuffer[],
  ): void {
    const record = this.#sources.get(warp.nodeId);
    const tx0 = Math.floor(warp.source.x / TILE_SIZE);
    const ty0 = Math.floor(warp.source.y / TILE_SIZE);
    const tx1 = Math.floor((warp.source.x + warp.source.width - 1) / TILE_SIZE);
    const ty1 = Math.floor((warp.source.y + warp.source.height - 1) / TILE_SIZE);
    const cols = tx1 - tx0 + 1;
    const rows = ty1 - ty0 + 1;
    const table = new Uint32Array(cols * rows).fill(EMPTY_SLOT);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const entry = record?.entries.get(tileKey(tx, ty));
        if (entry) table[(ty - ty0) * cols + (tx - tx0)] = entry.slot;
      }
    }
    this.#gpu.warpPreview.encode(
      encoder,
      {
        target: this.#warped!.createView(),
        atlas: this.#atlas.texture.createView({ dimension: '2d-array' }),
        selection: this.selection.createView(),
        useSelection: this.#source!.selection !== null,
        docWidth: this.width,
        docHeight: this.height,
        source: warp.source,
        mesh: warp.mesh,
        table,
        tableOrigin: [tx0, ty0],
        tableSize: [cols, rows],
      },
      transients,
    );
  }

  #encodeStep(
    encoder: GPUCommandEncoder,
    step: PlanStep,
    tx0: number,
    ty0: number,
    tx1: number,
    ty1: number,
    tileRect: Rect,
    target: 'final' | GPUTexture,
    transients: GPUBuffer[],
  ): void {
    switch (step.kind) {
      case 'composite': {
        const { headers, instructions } = this.#buildProgram(step.program, tx0, ty0, tx1, ty1);
        const toFinal = step.target === 'final';
        const output = toFinal ? (target === 'final' ? this.composite : target) : this.#scratch!;
        const warp = this.#source!.warpPreview;
        this.#gpu.compositor.encode(
          encoder,
          {
            output: output.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
            outputKind: toFinal ? 'rgba16float' : 'rgba16uint',
            atlas: this.#atlas.texture.createView({ dimension: '2d-array' }),
            results:
              this.#results?.createView({ dimension: '2d-array' }) ??
              this.#dummyArray.createView({ dimension: '2d-array' }),
            filterOut: this.#filterOut?.createView() ?? this.#dummyUint.createView(),
            selection: this.selection.createView(),
            warped: this.#warped?.createView() ?? this.#dummyUint.createView(),
            headers,
            instructions,
            docWidth: this.width,
            docHeight: this.height,
            warpRect: warp ? [warp.source.x, warp.source.y, warp.source.width, warp.source.height] : [0, 0, 0, 0],
            warpUseSelection: this.#source!.selection !== null,
          },
          transients,
        );
        if (!toFinal) this.#copyToStage(encoder, this.#scratch!, step.target as number, tileRect);
        return;
      }
      case 'filter': {
        const results = this.#results!;
        this.#gpu.filterPass.encode(encoder, {
          filter: step.filter,
          input: results.createView({ dimension: '2d', baseArrayLayer: step.inputLayer, arrayLayerCount: 1 }),
          inputOffset: [0, 0],
          inputSize: [this.width, this.height],
          output: this.#filterOut!.createView(),
          outputOffset: [0, 0],
          region: tileRect,
          bounds: this.#docRect,
          mask:
            step.useSelection && this.#source!.selection
              ? { view: this.selection.createView(), offset: [0, 0], size: [this.width, this.height] }
              : null,
          transients,
        });
        return;
      }
      case 'copyFilterOut':
        this.#copyToStage(encoder, this.#filterOut!, step.layer, tileRect);
        return;
    }
  }

  #copyToStage(encoder: GPUCommandEncoder, from: GPUTexture, layer: number, rect: Rect): void {
    encoder.copyTextureToTexture(
      { texture: from, origin: { x: rect.x, y: rect.y } },
      { texture: this.#results!, origin: { x: rect.x, y: rect.y, z: layer } },
      { width: rect.width, height: rect.height },
    );
  }

  /** Expands a program into per-tile instruction lists, resolving node ids to atlas slots. */
  #buildProgram(program: readonly ProgramItem[], tx0: number, ty0: number, tx1: number, ty1: number) {
    const tiles = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    const headers = new Uint32Array(tiles * 4);
    const instructions: number[] = [];
    let t = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = tileKey(tx, ty);
        const offset = instructions.length / 4;
        for (const item of program) {
          switch (item.op) {
            case 'layer': {
              const slot = this.#sources.get(item.nodeId)?.entries.get(key)?.slot;
              if (slot === undefined && !item.warp) break;
              instructions.push(
                item.warp ? OP.warpLayer : OP.layer,
                slot ?? EMPTY_SLOT,
                item.mode,
                floatBits(item.opacity),
              );
              break;
            }
            case 'result':
              instructions.push(OP.result, item.layer, item.mode, floatBits(item.opacity));
              break;
            case 'filterOut':
              instructions.push(OP.filterOut, 0, item.mode, floatBits(item.opacity));
              break;
            case 'push':
              instructions.push(OP.push, 0, 0, 0);
              break;
            case 'pop':
              instructions.push(OP.pop, 0, item.mode, floatBits(item.opacity));
              break;
            case 'base':
              instructions.push(OP.base, item.layer, 0, 0);
              break;
          }
        }
        headers.set([tx, ty, offset, instructions.length / 4 - offset], t * 4);
        t++;
      }
    }
    return { headers, instructions: new Uint32Array(instructions) };
  }

  async readComposite(): Promise<Uint8ClampedArray> {
    const bytes = await readTexture(this.#gpu.device, this.composite, 8, this.width, this.height);
    return halfPremultipliedToRgba8(bytes);
  }

  async readGroup(groupId: NodeId): Promise<Uint8ClampedArray> {
    const source = this.#source;
    const group = source?.state.nodes.get(groupId);
    if (!source || group?.kind !== 'group') throw new Error(`Node ${groupId} is not a group`);
    const plan = planComposite(source.state, group.childIds, {
      filters: this.#filters,
      warpNodeId: null,
      filterPreview: null,
    });
    const target = this.#gpu.device.createTexture({
      label: 'group readback',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    // The group plan reuses stage layers of the main plan, so the next sync recomposites everything.
    this.#structureKey = '';
    this.#render(plan, this.#docRect, target);
    const bytes = await readTexture(this.#gpu.device, target, 8, this.width, this.height);
    target.destroy();
    return halfPremultipliedToRgba8(bytes);
  }

  /** Whether views should draw selection feedback. */
  get hasSelection(): boolean {
    return this.#source !== null && (this.#source.selection !== null || this.#source.liveSelection !== null);
  }

  get quickMask(): boolean {
    return this.#source?.quickMask ?? false;
  }

  get selectionOffset(): RenderSource['selectionOffset'] {
    return this.#source?.selectionOffset ?? null;
  }

  dispose(): void {
    this.#atlas.dispose();
    this.#composite.destroy();
    this.#selection.destroy();
    this.#dummyUint.destroy();
    this.#dummyArray.destroy();
    this.#results?.destroy();
    this.#scratch?.destroy();
    this.#filterOut?.destroy();
    this.#warped?.destroy();
  }
}
