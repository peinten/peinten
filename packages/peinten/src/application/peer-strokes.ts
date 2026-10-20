import type { ColorMixer } from '../domain/brush/color-mixer.ts';
import type { BrushSettings } from '../domain/brush/settings.ts';
import type { ClientId, DocNode, NodeId } from '../domain/document/nodes.ts';
import type { DocState } from '../domain/document/state.ts';
import type { Batch } from '../domain/history/timeline.ts';
import { type Operation, OperationConflictError } from '../domain/ops/operation.ts';
import type { StrokeDraft } from '../domain/ops/raster-ops.ts';
import { StrokeRenderer } from '../domain/ops/stroke-renderer.ts';
import type { TileKey } from '../domain/tiles/tile.ts';
import type { MaskMap } from '../domain/tiles/tile-map.ts';
import type { StrokeProgress } from './collab/protocol.ts';
import type { LiveTiles } from './ports/renderer.ts';

/** How long a finished stroke stays on screen waiting for its commit, which never comes when it was rejected. */
const COMMIT_TIMEOUT_MS = 10_000;

interface PeerStroke {
  readonly clientId: ClientId;
  readonly nodeId: NodeId;
  readonly brush: BrushSettings;
  readonly seed: number;
  readonly chunks: Float32Array[];
  /** The layer and the peer's selection the renderer was built on; null until the first frame. */
  base: { readonly node: DocNode | undefined; readonly clip: MaskMap | undefined } | null;
  /** Null when the stroke cannot be drawn on the current state, e.g. its layer is locked. */
  renderer: StrokeRenderer | null;
}

interface PeerStrokesOptions {
  readonly mixer: ColorMixer;
  /** Requests a frame. */
  readonly changed: () => void;
  /** Runs a task after the commits already queued, so a late commit can still replace its preview. */
  readonly run: (task: () => void) => void;
}

/**
 * Previews of strokes that peers are still drawing. Each one replays the relayed samples on the current state with
 * the same renderer as the `stroke` operation, so it looks like the commit that replaces it.
 */
export class PeerStrokes {
  readonly #options: PeerStrokesOptions;
  readonly #strokes = new Map<string, PeerStroke>();

  constructor(options: PeerStrokesOptions) {
    this.#options = options;
  }

  receive(clientId: ClientId, progress: StrokeProgress): void {
    const key = strokeKey(clientId, progress.seed);
    switch (progress.phase) {
      case 'begin':
        this.#strokes.set(key, {
          clientId,
          nodeId: progress.nodeId,
          brush: progress.brush,
          seed: progress.seed,
          chunks: [],
          base: null,
          renderer: null,
        });
        break;
      case 'samples': {
        // Strokes that began before this client joined are not previewed.
        const stroke = this.#strokes.get(key);
        if (!stroke) return;
        stroke.chunks.push(progress.samples);
        stroke.renderer?.feed(progress.samples);
        break;
      }
      case 'end':
        if (!progress.cancelled) {
          setTimeout(() => this.#options.run(() => this.#remove(key)), COMMIT_TIMEOUT_MS);
          return;
        }
        if (!this.#strokes.delete(key)) return;
        break;
    }
    this.#options.changed();
  }

  /** Drops the previews that the strokes of a confirmed batch replace. */
  committed(batch: Batch): void {
    for (const op of batch.ops)
      if (op.type === 'stroke') this.#remove(strokeKey(batch.clientId, (op as Operation<StrokeDraft>).seed));
  }

  clear(): void {
    if (this.#strokes.size === 0) return;
    this.#strokes.clear();
    this.#options.changed();
  }

  /** Live tiles to draw over `state`, and the tiles that changed since the previous frame per node. */
  frame(state: DocState): { live: LiveTiles[]; dirty: Map<NodeId, TileKey[]> } {
    const live: LiveTiles[] = [];
    const dirty = new Map<NodeId, TileKey[]>();
    for (const stroke of this.#strokes.values()) {
      const node = state.nodes.get(stroke.nodeId);
      const clip = state.selections.get(stroke.clientId);
      if (!stroke.base || stroke.base.node !== node || stroke.base.clip !== clip) this.#build(stroke, state);
      if (!stroke.renderer) continue;
      live.push({ nodeId: stroke.nodeId, tiles: stroke.renderer.surface.workingTiles });
      dirty.set(stroke.nodeId, [...(dirty.get(stroke.nodeId) ?? []), ...stroke.renderer.takeDirty()]);
    }
    return { live, dirty };
  }

  /** Replays the stroke on `state`, whose layer or selection differs from what the preview was drawn on. */
  #build(stroke: PeerStroke, state: DocState): void {
    stroke.base = { node: state.nodes.get(stroke.nodeId), clip: state.selections.get(stroke.clientId) };
    try {
      stroke.renderer = new StrokeRenderer(
        state,
        { target: { nodeId: stroke.nodeId }, brush: stroke.brush, seed: stroke.seed, clientId: stroke.clientId },
        this.#options.mixer,
      );
    } catch (error) {
      if (!(error instanceof OperationConflictError)) throw error;
      stroke.renderer = null;
      return;
    }
    for (const chunk of stroke.chunks) stroke.renderer.feed(chunk);
  }

  #remove(key: string): void {
    if (this.#strokes.delete(key)) this.#options.changed();
  }
}

function strokeKey(clientId: ClientId, seed: number): string {
  return `${clientId}\n${seed}`;
}
