import type { NodeId } from '../../domain/document/nodes.ts';
import { TILE_SIZE, type TileKey, tileCoords } from '../../domain/tiles/tile.ts';
import { type Rect, type TileMap, unionRect } from '../../domain/tiles/tile-map.ts';
import { TileAtlas } from './tile-atlas.ts';

interface SlotEntry {
  tile: Uint16Array;
  slot: number;
}

/** Working tiles of strokes in progress that shadow a node's committed tiles; earlier ones win. */
export type LiveLayers = readonly ReadonlyMap<TileKey, Uint16Array>[];

interface SourceRecord {
  committed: TileMap<Uint16Array>;
  live: LiveLayers;
  entries: Map<TileKey, SlotEntry>;
}

function sameLayers(a: LiveLayers, b: LiveLayers): boolean {
  return a.length === b.length && a.every((tiles, i) => tiles === b[i]);
}

/**
 * The tiles of many nodes in one atlas, uploaded only when they change. Layer pixels use an `rgba16uint` instance
 * and layer masks an `r16uint` one.
 */
export class TileSources {
  readonly atlas: TileAtlas;
  readonly #records = new Map<NodeId, SourceRecord>();

  constructor(device: GPUDevice, format: 'rgba16uint' | 'r16uint') {
    this.atlas = new TileAtlas(device, format);
  }

  /** Uploads changed tiles of one node. Returns the bounds of the tiles that changed. */
  sync(nodeId: NodeId, committed: TileMap<Uint16Array>, live: LiveLayers, liveKeys: readonly TileKey[]): Rect | null {
    let record = this.#records.get(nodeId);
    if (!record) {
      record = { committed: new Map(), live: [], entries: new Map() };
      this.#records.set(nodeId, record);
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
        this.atlas.release(entry.slot);
        record.entries.delete(key);
        mark(key);
        return;
      }
      if (entry && entry.tile === tile && !force) return;
      const slot = entry?.slot ?? this.atlas.allocate();
      this.atlas.upload(slot, tile);
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

  /** Atlas slot of one tile of a node, if it has one. */
  slot(nodeId: NodeId, key: TileKey): number | undefined {
    return this.#records.get(nodeId)?.entries.get(key)?.slot;
  }

  /** Frees the tiles of every node not in `keep`. */
  prune(keep: ReadonlySet<NodeId>): void {
    for (const [id, record] of this.#records) {
      if (keep.has(id)) continue;
      for (const entry of record.entries.values()) this.atlas.release(entry.slot);
      this.#records.delete(id);
    }
  }

  dispose(): void {
    this.atlas.dispose();
  }
}
