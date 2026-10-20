import type { Affine2D } from '../../domain/geometry/affine.ts';
import type { TextLayerData, TextStyle } from '../../domain/text/text-layer.ts';
import type { Rect } from '../../domain/tiles/tile-map.ts';

/** A positioned piece of text in text-local coordinates. */
export interface PositionedGlyph {
  readonly text: string;
  /** Index into the layer's runs, for the style. */
  readonly runIndex: number;
  /** Baseline origin. */
  readonly x: number;
  readonly y: number;
  readonly advance: number;
  /** Rotated by 90 degrees clockwise, used for non-CJK text in vertical writing. */
  readonly rotated: boolean;
}

/** Result of laying out a text layer. Keeps glyph positions so caret placement can be added later. */
export interface TextLayout {
  readonly glyphs: readonly PositionedGlyph[];
  /** Ink bounds in text-local coordinates. */
  readonly bounds: Rect;
}

/** Straight 8-bit RGBA placed in document pixels. */
export interface TextRasterImage {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Opaque font reference resolved by a FontProvider. */
export interface FontHandle {
  readonly style: TextStyle;
}

export interface FontProvider {
  resolve(style: TextStyle): Promise<FontHandle>;
}

/**
 * Lays out and rasterizes text layers. Split in two steps to match fontkit, where layout produces glyph
 * positions and rasterization fills glyph outlines.
 */
export interface TextEngine {
  readonly id: string;
  layout(text: TextLayerData): Promise<TextLayout>;
  rasterize(text: TextLayerData, layout: TextLayout, transform: Affine2D): TextRasterImage | null;
}
