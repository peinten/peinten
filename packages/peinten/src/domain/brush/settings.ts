import { BRUSH_INPUT_INFO, BRUSH_SETTING_INFO } from './settings-data.ts';

export type BrushSettingId = (typeof BRUSH_SETTING_INFO)[number]['id'];
export type BrushInputId = (typeof BRUSH_INPUT_INFO)[number]['id'];

/** Control point of a dynamics curve: [input value, setting offset]. */
export type MappingPoint = readonly [x: number, y: number];

/** One setting of a brush: a base value plus optional input curves that are added to it. */
export interface BrushSettingValue {
  readonly baseValue: number;
  readonly inputs?: { readonly [I in BrushInputId]?: readonly MappingPoint[] };
}

/**
 * A brush in libmypaint's model. Settings that are absent use libmypaint's defaults.
 * Structured-clone friendly, so it travels inside stroke operations.
 */
export interface BrushSettings {
  readonly name?: string;
  readonly settings: { readonly [S in BrushSettingId]?: BrushSettingValue };
}

export const SETTING_COUNT = BRUSH_SETTING_INFO.length;
export const INPUT_COUNT = BRUSH_INPUT_INFO.length;

function indexMap<T extends string>(ids: readonly { id: T }[]): Record<T, number> {
  return Object.fromEntries(ids.map((info, i) => [info.id, i])) as Record<T, number>;
}

/** libmypaint setting ids. */
export const S = indexMap<BrushSettingId>(BRUSH_SETTING_INFO);
/** libmypaint input ids. */
export const I = indexMap<BrushInputId>(BRUSH_INPUT_INFO);

export function isSettingId(id: string): id is BrushSettingId {
  return id in S;
}

export function isInputId(id: string): id is BrushInputId {
  return id in I;
}

/** Equivalent of libmypaint's `mypaint_brush_from_defaults`. */
export const DEFAULT_BRUSH: BrushSettings = {
  name: 'Default',
  settings: {
    opaque_multiply: {
      baseValue: 0,
      inputs: {
        pressure: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  },
};

/** Returns the base value of a setting, falling back to the libmypaint default. */
export function baseValueOf(brush: BrushSettings, id: BrushSettingId): number {
  return brush.settings[id]?.baseValue ?? BRUSH_SETTING_INFO[S[id]]!.default;
}

/** Returns a copy of the brush with the given base values replaced, keeping input curves. */
export function withBaseValues(
  brush: BrushSettings,
  values: { readonly [S in BrushSettingId]?: number },
): BrushSettings {
  const settings: { [S in BrushSettingId]?: BrushSettingValue } = { ...brush.settings };
  for (const [id, baseValue] of Object.entries(values) as [BrushSettingId, number][]) {
    settings[id] = { ...settings[id], baseValue };
  }
  return { ...brush, settings };
}
