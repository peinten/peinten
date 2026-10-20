import type { Affine2D } from '../geometry/affine.ts';

export interface TextStyle {
  readonly fontFamily: string;
  readonly fontWeight: number;
  readonly fontStyle: 'normal' | 'italic';
  readonly fontSize: number;
  /** Straight (non-premultiplied) RGBA in 0..1. */
  readonly color: readonly [number, number, number, number];
  readonly letterSpacing: number;
}

/** A span of text sharing one style. */
export interface TextRun {
  readonly text: string;
  readonly style: TextStyle;
}

export type TextFrame =
  | { readonly kind: 'point' }
  | { readonly kind: 'area'; readonly width: number; readonly height: number };

export type WritingMode = 'horizontal-tb' | 'vertical-rl';

export interface TextParagraph {
  readonly align: 'start' | 'center' | 'end';
  /** Multiplier of the font size. */
  readonly lineHeight: number;
}

/** Everything needed to lay out and render a text layer. */
export interface TextLayerData {
  /** Maps text-local coordinates to document pixels. Kept non-destructively so the text stays editable. */
  readonly transform: Affine2D;
  readonly frame: TextFrame;
  readonly writingMode: WritingMode;
  readonly paragraph: TextParagraph;
  readonly runs: readonly TextRun[];
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'sans-serif',
  fontWeight: 400,
  fontStyle: 'normal',
  fontSize: 32,
  color: [0, 0, 0, 1],
  letterSpacing: 0,
};

/** Concatenates the text of all runs. */
export function plainText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('');
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle &&
    a.fontSize === b.fontSize &&
    a.letterSpacing === b.letterSpacing &&
    a.color.every((c, i) => c === b.color[i])
  );
}

/** Drops empty runs and merges neighbours that share a style. */
function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const result: TextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = result.at(-1);
    if (last && sameStyle(last.style, run.style)) {
      result[result.length - 1] = { text: last.text + run.text, style: last.style };
    } else {
      result.push(run);
    }
  }
  return result;
}

/** Splits runs so that `offset` falls on a run boundary. Returns the index of the first run at or after `offset`. */
function splitAt(runs: TextRun[], offset: number): number {
  let position = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const end = position + run.text.length;
    if (offset === position) return i;
    if (offset < end) {
      const cut = offset - position;
      runs.splice(
        i,
        1,
        { text: run.text.slice(0, cut), style: run.style },
        { text: run.text.slice(cut), style: run.style },
      );
      return i + 1;
    }
    position = end;
  }
  return runs.length;
}

/**
 * Replaces the UTF-16 range [start, end) with `text`.
 * Inserted text takes the style of the character before `start`, or of the first run when inserting at 0.
 */
export function replaceText(
  runs: readonly TextRun[],
  start: number,
  end: number,
  text: string,
  fallback = DEFAULT_TEXT_STYLE,
): TextRun[] {
  const work = [...runs];
  const from = splitAt(work, start);
  const to = splitAt(work, end);
  const style = work[from - 1]?.style ?? work[from]?.style ?? fallback;
  work.splice(from, to - from, { text, style });
  return normalizeRuns(work);
}

/** Applies a partial style to the UTF-16 range [start, end). */
export function applyStyle(runs: readonly TextRun[], start: number, end: number, patch: Partial<TextStyle>): TextRun[] {
  const work = [...runs];
  const from = splitAt(work, start);
  const to = splitAt(work, end);
  for (let i = from; i < to; i++) {
    const run = work[i]!;
    work[i] = { text: run.text, style: { ...run.style, ...patch } };
  }
  return normalizeRuns(work);
}
