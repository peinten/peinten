import type {
  FontHandle,
  FontProvider,
  PositionedGlyph,
  TextEngine,
  TextLayout,
  TextRasterImage,
} from '../../application/ports/text.ts';
import { type Affine2D, applyAffine } from '../../domain/geometry/affine.ts';
import type { TextLayerData, TextStyle } from '../../domain/text/text-layer.ts';

const MAX_RASTER_SIZE = 8192;
/** Ideographs, kana, hangul and full-width forms stay upright in vertical writing. */
const UPRIGHT = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/u;
/** Punctuation drawn in the upper right of its cell in vertical writing. */
const VERTICAL_PUNCTUATION = /[、。，．]/u;

/** CSS font shorthand for a style. */
function cssFont(style: TextStyle): string {
  const family = /^[a-z-]+$/i.test(style.fontFamily) ? style.fontFamily : `"${style.fontFamily.replaceAll('"', '')}"`;
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${family}`;
}

/** Resolves fonts through the FontFaceSet visible to this thread, waiting for web fonts to load. */
export class CanvasFontProvider implements FontProvider {
  async resolve(style: TextStyle): Promise<FontHandle> {
    const fonts =
      (globalThis as { fonts?: FontFaceSet }).fonts ?? (globalThis as { document?: Document }).document?.fonts;
    try {
      await fonts?.load(cssFont(style));
    } catch {
      // Unknown families fall back to the platform default, like CSS does.
    }
    return { style };
  }
}

interface Grapheme {
  readonly text: string;
  readonly runIndex: number;
  readonly style: TextStyle;
}

function graphemes(text: TextLayerData): Grapheme[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return text.runs.flatMap((run, runIndex) =>
    [...segmenter.segment(run.text)].map(({ segment }) => ({ text: segment, runIndex, style: run.style })),
  );
}

/** Splits a line into wrap units: words for Latin text, single graphemes for CJK. */
function wrapUnits(line: Grapheme[]): Grapheme[][] {
  const units: Grapheme[][] = [];
  let word: Grapheme[] = [];
  for (const g of line) {
    if (UPRIGHT.test(g.text) || /\s/u.test(g.text)) {
      if (word.length) units.push(word);
      units.push([g]);
      word = [];
    } else {
      word.push(g);
    }
  }
  if (word.length) units.push(word);
  return units;
}

/**
 * Text layout and rasterization with Canvas2D `measureText` and `fillText`.
 * Vertical writing stacks graphemes top to bottom, keeps CJK upright and rotates other text by 90 degrees.
 * Results depend on the platform's fonts, which is why operations that read text pixels embed them.
 */
export class CanvasTextEngine implements TextEngine {
  readonly id = 'canvas';
  readonly #fonts: FontProvider;
  readonly #measure: OffscreenCanvasRenderingContext2D;

  constructor(fonts: FontProvider = new CanvasFontProvider()) {
    this.#fonts = fonts;
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.#measure = ctx;
  }

  #advance(g: Grapheme): number {
    this.#measure.font = cssFont(g.style);
    return this.#measure.measureText(g.text).width + g.style.letterSpacing;
  }

  async layout(text: TextLayerData): Promise<TextLayout> {
    const unique = new Map(text.runs.map((run) => [cssFont(run.style), run.style]));
    await Promise.all([...unique.values()].map((style) => this.#fonts.resolve(style)));
    const all = graphemes(text);
    const lines: Grapheme[][] = [[]];
    for (const g of all) {
      if (g.text === '\n') lines.push([]);
      else lines.at(-1)!.push(g);
    }
    const vertical = text.writingMode === 'vertical-rl';
    const limit =
      text.frame.kind === 'area' ? (vertical ? text.frame.height : text.frame.width) : Number.POSITIVE_INFINITY;
    const size = (g: Grapheme) =>
      vertical && UPRIGHT.test(g.text) ? g.style.fontSize + g.style.letterSpacing : this.#advance(g);

    // Break into visual lines (columns in vertical mode) that fit the frame.
    const visual: Grapheme[][] = [];
    for (const line of lines) {
      let current: Grapheme[] = [];
      let length = 0;
      for (const unit of wrapUnits(line)) {
        const unitLength = unit.reduce((sum, g) => sum + size(g), 0);
        if (length + unitLength > limit && current.length) {
          visual.push(current);
          current = [];
          length = 0;
        }
        for (const g of unit) {
          const s = size(g);
          if (length + s > limit && current.length) {
            visual.push(current);
            current = [];
            length = 0;
          }
          current.push(g);
          length += s;
        }
      }
      visual.push(current);
    }

    const glyphs: PositionedGlyph[] = [];
    const lineSizes = visual.map(
      (line) =>
        Math.max(...line.map((g) => g.style.fontSize), text.runs[0]?.style.fontSize ?? 16) * text.paragraph.lineHeight,
    );
    const lineLengths = visual.map((line) => line.reduce((sum, g) => sum + size(g), 0));
    const extent = text.frame.kind === 'area' ? limit : Math.max(0, ...lineLengths);
    const align = (length: number) =>
      text.paragraph.align === 'center' ? (extent - length) / 2 : text.paragraph.align === 'end' ? extent - length : 0;
    let across = 0;
    visual.forEach((line, i) => {
      const lineSize = lineSizes[i]!;
      let along = align(lineLengths[i]!);
      for (const g of line) {
        const s = size(g);
        if (vertical) {
          const upright = UPRIGHT.test(g.text);
          const centerX = -(across + lineSize / 2);
          const punctuation = VERTICAL_PUNCTUATION.test(g.text) ? g.style.fontSize * 0.5 : 0;
          glyphs.push({
            text: g.text,
            runIndex: g.runIndex,
            x: centerX + punctuation,
            y: along + g.style.fontSize * 0.88 - punctuation,
            advance: s,
            rotated: !upright,
          });
        } else {
          glyphs.push({
            text: g.text,
            runIndex: g.runIndex,
            x: along,
            y: across + lineSize * 0.8,
            advance: s,
            rotated: false,
          });
        }
        along += s;
      }
      across += lineSize;
    });
    const bounds = vertical
      ? { x: -across, y: 0, width: across, height: extent }
      : { x: 0, y: 0, width: extent, height: across };
    return { glyphs, bounds };
  }

  rasterize(text: TextLayerData, layout: TextLayout, transform: Affine2D): TextRasterImage | null {
    const pad = Math.max(...text.runs.map((run) => run.style.fontSize), 16);
    const b = layout.bounds;
    const corners = [
      applyAffine(transform, b.x - pad, b.y - pad),
      applyAffine(transform, b.x + b.width + pad, b.y - pad),
      applyAffine(transform, b.x - pad, b.y + b.height + pad),
      applyAffine(transform, b.x + b.width + pad, b.y + b.height + pad),
    ];
    const x0 = Math.floor(Math.min(...corners.map((c) => c[0])));
    const y0 = Math.floor(Math.min(...corners.map((c) => c[1])));
    const width = Math.min(Math.ceil(Math.max(...corners.map((c) => c[0]))) - x0, MAX_RASTER_SIZE);
    const height = Math.min(Math.ceil(Math.max(...corners.map((c) => c[1]))) - y0, MAX_RASTER_SIZE);
    if (width <= 0 || height <= 0 || layout.glyphs.length === 0) return null;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const vertical = text.writingMode === 'vertical-rl';
    for (const glyph of layout.glyphs) {
      const style = text.runs[glyph.runIndex]!.style;
      const [r, g, bl, a] = style.color;
      ctx.setTransform(transform[0], transform[1], transform[2], transform[3], transform[4] - x0, transform[5] - y0);
      ctx.font = cssFont(style);
      ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)}, ${a})`;
      if (vertical && glyph.rotated) {
        ctx.translate(glyph.x, glyph.y - style.fontSize * 0.88);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph.text, 0, 0);
      } else {
        ctx.textAlign = vertical ? 'center' : 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(glyph.text, glyph.x, glyph.y);
      }
    }
    return { x: x0, y: y0, width, height, data: ctx.getImageData(0, 0, width, height).data };
  }
}
