import type { NodeId } from '../domain/document/nodes.ts';
import type { Thumbnail } from './snapshot.ts';

/**
 * Thumbnails of one kind, layer pixels or layer masks, keyed by node. It remembers what each was rendered from, so a
 * thumbnail is redone only when its source changes, and at most every `interval` milliseconds while it keeps changing.
 */
export class ThumbnailStore {
  readonly thumbnails = new Map<NodeId, Thumbnail>();
  readonly #sources = new Map<NodeId, { readonly source: unknown; readonly time: number }>();
  readonly #interval: number;

  constructor(interval: number) {
    this.#interval = interval;
  }

  /**
   * Whether to render the node's thumbnail from `source` now: `fresh` when it already shows that source, `later` when
   * it was redone too recently. `live` sources change in place, so they are redone on every interval.
   */
  due(nodeId: NodeId, source: unknown, live: boolean, time: number): 'now' | 'fresh' | 'later' {
    const known = this.#sources.get(nodeId);
    if (known && known.source === source && !live) return 'fresh';
    if (known && time - known.time < this.#interval) return 'later';
    this.#sources.set(nodeId, { source, time });
    return 'now';
  }

  set(nodeId: NodeId, thumbnail: Thumbnail): void {
    this.thumbnails.get(nodeId)?.bitmap.close();
    this.thumbnails.set(nodeId, thumbnail);
  }

  /** Drops the thumbnails of nodes for which `keep` is false. */
  prune(keep: (nodeId: NodeId) => boolean): void {
    for (const [id, thumbnail] of this.thumbnails) {
      if (keep(id)) continue;
      thumbnail.bitmap.close();
      this.thumbnails.delete(id);
      this.#sources.delete(id);
    }
  }

  dispose(): void {
    for (const thumbnail of this.thumbnails.values()) thumbnail.bitmap.close();
  }
}
