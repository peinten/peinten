/**
 * Stroke input is recorded as a flat Float32Array with this many values per sample:
 * x, y, pressure, xtilt (-1..1), ytilt (-1..1), dtime (seconds), viewzoom, viewrotation (radians), barrel rotation (turns).
 * Float32 keeps the payload small; live rendering consumes the same quantized values so peers reproduce it exactly.
 */
export const SAMPLE_STRIDE = 9;

export interface StrokeSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly xtilt: number;
  readonly ytilt: number;
  readonly dtime: number;
  readonly viewzoom: number;
  readonly viewrotation: number;
  readonly barrelRotation: number;
}

/** Growable recorder of stroke samples. */
export class SampleRecorder {
  #data = new Float32Array(SAMPLE_STRIDE * 256);
  #length = 0;

  /** Appends a sample and returns the quantized copy that must be fed to the brush engine. */
  push(sample: StrokeSample): Float32Array {
    if (this.#length + SAMPLE_STRIDE > this.#data.length) {
      const grown = new Float32Array(this.#data.length * 2);
      grown.set(this.#data);
      this.#data = grown;
    }
    const offset = this.#length;
    const d = this.#data;
    d[offset] = sample.x;
    d[offset + 1] = sample.y;
    d[offset + 2] = sample.pressure;
    d[offset + 3] = sample.xtilt;
    d[offset + 4] = sample.ytilt;
    d[offset + 5] = sample.dtime;
    d[offset + 6] = sample.viewzoom;
    d[offset + 7] = sample.viewrotation;
    d[offset + 8] = sample.barrelRotation;
    this.#length += SAMPLE_STRIDE;
    return d.subarray(offset, offset + SAMPLE_STRIDE);
  }

  /** Returns a compact copy of the recorded samples. */
  toArray(): Float32Array {
    return this.#data.slice(0, this.#length);
  }
}

/**
 * Samples of an S-shaped stroke whose pressure rises from 0 to 1 and back, for brush preview canvases.
 * Coordinates span the given size with a margin proportional to the height.
 */
export function previewStrokeSamples({ width, height }: { width: number; height: number }): Float32Array {
  const recorder = new SampleRecorder();
  const margin = height * 0.25;
  const count = Math.max(16, Math.round(width / 3));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    recorder.push({
      x: margin + t * (width - margin * 2),
      y: height / 2 + Math.sin(t * Math.PI * 2) * (height / 2 - margin),
      pressure: Math.sin(t * Math.PI),
      xtilt: 0,
      ytilt: 0,
      dtime: 1 / 120,
      viewzoom: 1,
      viewrotation: 0,
      barrelRotation: 0,
    });
  }
  return recorder.toArray();
}
