import * as v from 'valibot';
import type { TextLayerData } from './text-layer.ts';

const finite = v.pipe(v.number(), v.finite());
const unit = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export const textStyleSchema = v.object({
  fontFamily: v.pipe(v.string(), v.maxLength(256)),
  fontWeight: v.pipe(v.number(), v.minValue(1), v.maxValue(1000)),
  fontStyle: v.picklist(['normal', 'italic']),
  fontSize: v.pipe(v.number(), v.minValue(0.5), v.maxValue(4096)),
  color: v.tuple([unit, unit, unit, unit]),
  letterSpacing: finite,
});

export const textLayerDataSchema: v.GenericSchema<unknown, TextLayerData> = v.object({
  transform: v.tuple([finite, finite, finite, finite, finite, finite]),
  frame: v.variant('kind', [
    v.object({ kind: v.literal('point') }),
    v.object({
      kind: v.literal('area'),
      width: v.pipe(v.number(), v.minValue(1)),
      height: v.pipe(v.number(), v.minValue(1)),
    }),
  ]),
  writingMode: v.picklist(['horizontal-tb', 'vertical-rl']),
  paragraph: v.object({
    align: v.picklist(['start', 'center', 'end']),
    lineHeight: v.pipe(v.number(), v.minValue(0.1)),
  }),
  runs: v.array(v.object({ text: v.string(), style: textStyleSchema })),
});
