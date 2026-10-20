import * as v from 'valibot';
import type { AnyOperationDefinition, Operation, OperationDefinition } from './operation.ts';

const stampSchema = v.looseObject({ type: v.string(), id: v.string(), clientId: v.string() });

/** Looks up operation definitions and validates untrusted operations. */
export class OperationRegistry {
  readonly #definitions = new Map<string, OperationDefinition>();

  constructor(definitions: readonly AnyOperationDefinition[]) {
    for (const definition of definitions) {
      if (this.#definitions.has(definition.type)) throw new Error(`Duplicate operation type: ${definition.type}`);
      this.#definitions.set(definition.type, definition);
    }
  }

  get(type: string): OperationDefinition {
    const definition = this.#definitions.get(type);
    if (!definition) throw new Error(`Unknown operation type: ${type}`);
    return definition;
  }

  /** Validates an operation received from a file or a peer. Throws a valibot error when invalid. */
  parse(input: unknown): Operation {
    const stamp = v.parse(stampSchema, input);
    const payload = v.parse(this.get(stamp.type).schema, input);
    return { ...(payload as object), type: stamp.type, id: stamp.id, clientId: stamp.clientId };
  }

  types(): string[] {
    return [...this.#definitions.keys()].sort();
  }
}

/** FNV-1a over the given parts. Used to detect peers whose registries differ. */
export function registryHash(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of parts.join('\n')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
