import { BrushEngine } from '../brush/brush-engine.ts';
import type { ColorMixer } from '../brush/color-mixer.ts';
import { CompiledBrush } from '../brush/mapping.ts';
import { MaskSurface } from '../brush/mask-surface.ts';
import type { BrushSettings } from '../brush/settings.ts';
import { SAMPLE_STRIDE } from '../brush/stroke-samples.ts';
import { TiledSurface } from '../brush/tiled-surface.ts';
import type { ClientId, NodeId, PaintLayer } from '../document/nodes.ts';
import type { DocState } from '../document/state.ts';
import type { TileKey } from '../tiles/tile.ts';
import { OperationConflictError } from './operation.ts';

/** Where a stroke paints: a paint layer, or the issuing client's selection mask (quick mask). */
export type StrokeTarget = { readonly nodeId: NodeId } | { readonly selection: true };

export interface StrokeParams {
  readonly target: StrokeTarget;
  readonly brush: BrushSettings;
  readonly seed: number;
  readonly clientId: ClientId;
}

/**
 * Renders a stroke onto a copy-on-write surface. Shared by live strokes and by `stroke` replay
 * so both paths run the exact same code and produce identical tiles.
 */
export class StrokeRenderer {
  readonly #state: DocState;
  readonly #params: StrokeParams;
  readonly #engine: BrushEngine;
  readonly surface: TiledSurface | MaskSurface;

  constructor(state: DocState, params: StrokeParams, mixer: ColorMixer) {
    this.#state = state;
    this.#params = params;
    this.#engine = new BrushEngine(new CompiledBrush(params.brush), mixer, params.seed);
    const bounds = { x: 0, y: 0, width: state.width, height: state.height };
    if ('selection' in params.target) {
      this.surface = new MaskSurface(state.selections.get(params.clientId) ?? new Map(), bounds);
      return;
    }
    const layer = state.nodes.get(params.target.nodeId);
    if (layer?.kind !== 'paint') throw new OperationConflictError('Strokes can only target paint layers');
    if (layer.locked) throw new OperationConflictError(`Layer ${layer.id} is locked`);
    this.surface = new TiledSurface(layer.tiles, {
      mixer,
      bounds,
      clip: state.selections.get(params.clientId) ?? null,
      alphaLocked: layer.alphaLocked,
    });
  }

  /** Feeds samples in the `SAMPLE_STRIDE` layout to the brush engine. */
  feed(samples: Float32Array): void {
    for (let o = 0; o + SAMPLE_STRIDE <= samples.length; o += SAMPLE_STRIDE) {
      this.#engine.strokeTo(
        this.surface,
        samples[o]!,
        samples[o + 1]!,
        samples[o + 2]!,
        samples[o + 3]!,
        samples[o + 4]!,
        samples[o + 5]!,
        samples[o + 6]!,
        samples[o + 7]!,
        samples[o + 8]!,
      );
    }
  }

  /** Tiles written since the last call. */
  takeDirty(): TileKey[] {
    return this.surface.takeDirty();
  }

  /** Builds the committed state containing the stroke. */
  commit(): DocState {
    const state = this.#state;
    const target = this.#params.target;
    if ('selection' in target) {
      const mask = (this.surface as MaskSurface).commit();
      const selections = new Map(state.selections);
      if (mask.size === 0) selections.delete(this.#params.clientId);
      else selections.set(this.#params.clientId, mask);
      return { ...state, selections };
    }
    const layer = state.nodes.get(target.nodeId) as PaintLayer;
    const tiles = (this.surface as TiledSurface).commit();
    if (tiles === layer.tiles) return state;
    const nodes = new Map(state.nodes);
    nodes.set(layer.id, { ...layer, tiles });
    return { ...state, nodes };
  }
}
