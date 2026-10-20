import { hsvToRgb, rgbToHsv } from './color.ts';
import { type BrushSettingId, type BrushSettings, baseValueOf, withBaseValues } from './settings.ts';

/** Paint settings shared by every tool and view, in the spirit of Krita's canvas resource manager. */
export interface BrushResources {
  /** Straight RGB in 0..1. */
  readonly color: readonly [number, number, number];
  readonly brush: BrushSettings;
  /** Krita-style eraser mode: any brush erases instead of painting. */
  readonly eraser: boolean;
  /** Brush diameter in pixels overriding the brush's radius, or null to use the brush's own size. */
  readonly size: number | null;
  /** Multiplier for the brush's opacity, or null to use it unchanged. */
  readonly opacity: number | null;
}

/** Returns the brush with color, size, opacity and eraser mode baked into its base values. */
export function resolveBrush(resources: BrushResources): BrushSettings {
  const hsv = Float64Array.from(resources.color);
  rgbToHsv(hsv);
  const values: { [K in BrushSettingId]?: number } = { color_h: hsv[0]!, color_s: hsv[1]!, color_v: hsv[2]! };
  if (resources.size !== null) values.radius_logarithmic = Math.log(Math.max(resources.size, 0.4) / 2);
  if (resources.opacity !== null) values.opaque = baseValueOf(resources.brush, 'opaque') * resources.opacity;
  if (resources.eraser) values.eraser = 1;
  return withBaseValues(resources.brush, values);
}

/** Straight RGB color stored in a brush's color settings. */
export function brushColor(brush: BrushSettings): [number, number, number] {
  const rgb = Float64Array.of(
    baseValueOf(brush, 'color_h'),
    baseValueOf(brush, 'color_s'),
    baseValueOf(brush, 'color_v'),
  );
  hsvToRgb(rgb);
  return [rgb[0]!, rgb[1]!, rgb[2]!];
}

/** Brush diameter in pixels derived from its base radius. */
export function brushSize(brush: BrushSettings): number {
  return Math.exp(baseValueOf(brush, 'radius_logarithmic')) * 2;
}
