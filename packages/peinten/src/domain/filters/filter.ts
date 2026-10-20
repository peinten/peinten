import * as v from 'valibot';

/**
 * Parameters of each registered filter keyed by filter type.
 * Applications add their own filters through declaration merging.
 */
export interface FilterParamsMap {
  'gaussian-blur': { readonly radius: number };
}

export type FilterType = keyof FilterParamsMap & string;

/** A filter invocation: its type plus its parameters. */
export type FilterSpec = { [K in FilterType]: { readonly type: K } & FilterParamsMap[K] }[FilterType];

/** The device-independent half of a filter definition. The GPU kernel lives in infrastructure. */
export interface FilterDefinition<K extends FilterType = FilterType> {
  readonly type: K;
  readonly schema: v.GenericSchema<unknown, FilterParamsMap[K]>;
  /** Radius in pixels over which a single input pixel influences the output. */
  margin(params: FilterParamsMap[K]): number;
}

/** Maximum supported blur radius. Bounds the kernel size the GPU pass has to handle. */
export const MAX_BLUR_RADIUS = 250;

export const gaussianBlurFilter: FilterDefinition<'gaussian-blur'> = {
  type: 'gaussian-blur',
  schema: v.object({ radius: v.pipe(v.number(), v.minValue(0), v.maxValue(MAX_BLUR_RADIUS)) }),
  margin: ({ radius }) => Math.ceil(radius),
};

/** Lookup table of device-independent filter definitions. */
export class FilterRegistry {
  readonly #definitions = new Map<string, FilterDefinition>();

  constructor(definitions: readonly FilterDefinition[]) {
    for (const definition of definitions) this.#definitions.set(definition.type, definition);
  }

  get(type: string): FilterDefinition {
    const definition = this.#definitions.get(type);
    if (!definition) throw new Error(`Unknown filter type: ${type}`);
    return definition;
  }

  margin(spec: FilterSpec): number {
    return this.get(spec.type).margin(spec as never);
  }

  /** Validates untrusted filter specs coming from files or peers. */
  parse(input: unknown): FilterSpec {
    const base = v.parse(v.looseObject({ type: v.string() }), input);
    const params = v.parse(this.get(base.type).schema, input);
    return { ...(params as object), type: base.type } as FilterSpec;
  }

  types(): string[] {
    return [...this.#definitions.keys()].sort();
  }
}
