import { type BrushSettings, I, SETTING_COUNT } from './settings.ts';
import { BRUSH_SETTING_INFO } from './settings-data.ts';

interface Curve {
  readonly input: number;
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

/**
 * Brush settings compiled for fast per-dab evaluation.
 * Port of libmypaint's MyPaintMapping: the value of a setting is its base value plus one piecewise-linear
 * curve per used input.
 */
export class CompiledBrush {
  readonly base = new Float64Array(SETTING_COUNT);
  readonly #curves: (readonly Curve[])[] = [];

  constructor(brush: BrushSettings) {
    for (let s = 0; s < SETTING_COUNT; s++) {
      const info = BRUSH_SETTING_INFO[s]!;
      const value = brush.settings[info.id];
      this.base[s] = value?.baseValue ?? info.default;
      const curves: Curve[] = [];
      for (const [inputId, points] of Object.entries(value?.inputs ?? {})) {
        if (!points || points.length < 2) continue;
        curves.push({
          input: I[inputId as keyof typeof I],
          xs: Float64Array.from(points, (p) => p[0]),
          ys: Float64Array.from(points, (p) => p[1]),
        });
      }
      this.#curves.push(curves);
    }
  }

  /** True when the setting has no input curves, i.e. libmypaint's `mypaint_mapping_is_constant`. */
  isConstant(setting: number): boolean {
    return this.#curves[setting]!.length === 0;
  }

  /** Evaluates every setting for the given inputs. Port of `mypaint_mapping_calculate`. */
  calculate(inputs: Float64Array, out: Float64Array): void {
    for (let s = 0; s < SETTING_COUNT; s++) {
      let result = this.base[s]!;
      for (const curve of this.#curves[s]!) {
        const x = inputs[curve.input]!;
        const { xs, ys } = curve;
        let x0 = xs[0]!;
        let y0 = ys[0]!;
        let x1 = xs[1]!;
        let y1 = ys[1]!;
        for (let i = 2; i < xs.length && x > x1; i++) {
          x0 = x1;
          y0 = y1;
          x1 = xs[i]!;
          y1 = ys[i]!;
        }
        result += x0 === x1 || y0 === y1 ? y0 : (y1 * (x - x0) + y0 * (x1 - x)) / (x1 - x0);
      }
      out[s] = result;
    }
  }
}
