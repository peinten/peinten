import * as v from 'valibot';
import {
  type BrushInputId,
  type BrushSettings,
  type BrushSettingValue,
  isInputId,
  isSettingId,
  type MappingPoint,
} from './settings.ts';

const pointSchema = v.tuple([v.number(), v.number()]);
const mybSchema = v.looseObject({
  version: v.literal(3),
  settings: v.record(
    v.string(),
    v.object({
      base_value: v.number(),
      inputs: v.optional(v.record(v.string(), v.array(pointSchema)), {}),
    }),
  ),
});

export interface ParsedMyb {
  readonly brush: BrushSettings;
  /** Settings or inputs the file uses that this engine does not know. They are ignored, as libmypaint does. */
  readonly ignored: readonly string[];
}

/** Parses a MyPaint brush file (`.myb`, JSON version 3). Throws when the file is not a valid brush. */
export function parseMyb(text: string, name?: string): ParsedMyb {
  const json = v.parse(mybSchema, JSON.parse(text));
  const ignored: string[] = [];
  const settings: { [K in string]?: BrushSettingValue } = {};
  for (const [settingId, value] of Object.entries(json.settings)) {
    if (!isSettingId(settingId)) {
      ignored.push(settingId);
      continue;
    }
    const inputs: { [I in BrushInputId]?: readonly MappingPoint[] } = {};
    for (const [inputId, points] of Object.entries(value.inputs)) {
      if (!isInputId(inputId)) {
        ignored.push(`${settingId}.${inputId}`);
        continue;
      }
      // libmypaint rejects single-point curves; an empty curve means "unused".
      if (points.length >= 2) inputs[inputId] = points.map(([x, y]) => [x, y] as const);
    }
    settings[settingId] = { baseValue: value.base_value, inputs };
  }
  return { brush: { name, settings: settings as BrushSettings['settings'] }, ignored };
}

/** Serializes a brush to MyPaint's `.myb` JSON (version 3). */
export function serializeMyb(brush: BrushSettings): string {
  const settings: Record<string, { base_value: number; inputs: Record<string, MappingPoint[]> }> = {};
  for (const [settingId, value] of Object.entries(brush.settings)) {
    if (!value) continue;
    const inputs: Record<string, MappingPoint[]> = {};
    for (const [inputId, points] of Object.entries(value.inputs ?? {})) {
      if (points) inputs[inputId] = points.map(([x, y]) => [x, y] as const);
    }
    settings[settingId] = { base_value: value.baseValue, inputs };
  }
  return JSON.stringify({ comment: 'MyPaint brush file', version: 3, settings }, null, 4);
}

const settingValueSchema = v.object({
  baseValue: v.pipe(v.number(), v.finite()),
  inputs: v.optional(v.record(v.string(), v.pipe(v.array(pointSchema), v.maxLength(64)))),
});

/** Valibot schema for brushes arriving inside operations from peers. */
export const brushSettingsSchema = v.object({
  name: v.optional(v.string()),
  settings: v.pipe(
    v.record(v.string(), settingValueSchema),
    v.check(
      (settings) =>
        Object.entries(settings).every(
          ([id, value]) => isSettingId(id) && Object.keys(value.inputs ?? {}).every(isInputId),
        ),
      'Unknown brush setting or input',
    ),
  ),
}) as unknown as v.GenericSchema<unknown, BrushSettings>;
