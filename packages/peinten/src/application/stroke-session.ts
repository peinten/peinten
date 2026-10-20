import type { ColorMixer } from '../domain/brush/color-mixer.ts';
import { SampleRecorder, type StrokeSample } from '../domain/brush/stroke-samples.ts';
import type { DocState } from '../domain/document/state.ts';
import type { StrokeDraft } from '../domain/ops/raster-ops.ts';
import { type StrokeParams, StrokeRenderer } from '../domain/ops/stroke-renderer.ts';
import type { TileKey } from '../domain/tiles/tile.ts';

/**
 * State of a stroke in progress. Changes never enter DocState until the stroke ends: the renderer paints into
 * copy-on-write working tiles, which the view draws on top of the committed tiles.
 */
export class StrokeSession {
  readonly base: DocState;
  readonly params: StrokeParams;
  readonly #renderer: StrokeRenderer;
  readonly #recorder = new SampleRecorder();

  constructor(base: DocState, params: StrokeParams, mixer: ColorMixer) {
    this.base = base;
    this.params = params;
    this.#renderer = new StrokeRenderer(base, params, mixer);
  }

  /** Records the sample and renders the quantized copy, exactly what replaying the stroke will see. Returns that copy. */
  addSample(sample: StrokeSample): Float32Array {
    const quantized = this.#recorder.push(sample);
    this.#renderer.feed(quantized);
    return quantized;
  }

  get workingTiles(): ReadonlyMap<TileKey, Uint16Array> {
    return this.#renderer.surface.workingTiles;
  }

  takeDirty(): TileKey[] {
    return this.#renderer.takeDirty();
  }

  /** Freezes the stroke into a committed state plus the operation that reproduces it. */
  finish(): { state: DocState; draft: StrokeDraft } {
    return {
      state: this.#renderer.commit(),
      draft: {
        type: 'stroke',
        target: this.params.target,
        brush: this.params.brush,
        samples: this.#recorder.toArray(),
        seed: this.params.seed,
      },
    };
  }
}
