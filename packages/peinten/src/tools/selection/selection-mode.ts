import type { Modifiers } from '../../application/tool.ts';
import type { SelectionMode } from '../../domain/document/selection.ts';

/** Options shared by every selection tool. */
export interface SelectionToolOptions {
  readonly mode: SelectionMode;
  readonly antialias: boolean;
}

export const DEFAULT_SELECTION_OPTIONS: SelectionToolOptions = { mode: 'replace', antialias: true };

/** Modifier keys override the configured mode, as in Krita: Shift adds, Alt subtracts, both intersect. */
export function resolveSelectionMode(configured: SelectionMode, modifiers: Modifiers): SelectionMode {
  if (modifiers.shift && modifiers.alt) return 'intersect';
  if (modifiers.shift) return 'add';
  if (modifiers.alt) return 'subtract';
  return configured;
}

/** Dashed preview line color. */
export const PREVIEW_STYLE = { width: 1, dashed: true, color: [1, 1, 1, 1] as const };
