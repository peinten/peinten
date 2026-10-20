/** Everything libmypaint passes to `mypaint_surface_draw_dab`. Colors are straight RGB in 0..1. */
export interface DabParams {
  x: number;
  y: number;
  radius: number;
  colorR: number;
  colorG: number;
  colorB: number;
  opaque: number;
  hardness: number;
  softness: number;
  /** Target alpha: 1 paints, 0 erases, values in between smudge transparency. */
  colorA: number;
  aspectRatio: number;
  /** Degrees. */
  angle: number;
  lockAlpha: number;
  colorize: number;
  posterize: number;
  posterizeNum: number;
  /** Pigment mixing amount (libmypaint's paint_mode). */
  paint: number;
}

/** Drawing target of the brush engine. Port of libmypaint's MyPaintSurface interface. */
export interface Surface {
  /** Returns true when pixels were modified. */
  drawDab(dab: Readonly<DabParams>): boolean;
  /**
   * Writes the average straight RGBA under a soft dab into `out`.
   * A negative `paint` selects libmypaint's legacy additive sampling.
   */
  getColor(x: number, y: number, radius: number, out: Float64Array, paint: number): void;
}
