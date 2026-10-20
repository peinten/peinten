import * as v from 'valibot';
import { BLEND_MODES } from './blend-mode.ts';

export const nodeIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
export const opacitySchema = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
export const blendModeSchema = v.picklist(BLEND_MODES);
/** Filter specs are checked against the filter registry when applied, because the registry is extensible. */
export const filterSpecSchema = v.looseObject({ type: v.string() });
export const nameSchema = v.pipe(v.string(), v.maxLength(256));
export const indexSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
