import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { defineOperation } from './operation.ts';
import { OperationRegistry, registryHash } from './registry.ts';

const definition = (version?: number) =>
  defineOperation<{ type: 'noop' }>({ type: 'noop', version, schema: v.object({}), apply: (state) => state });

describe('OperationRegistry', () => {
  it('keeps version 1 out of the hash and refuses peers whose versions differ', () => {
    const hash = (version?: number) => registryHash(new OperationRegistry([definition(version)]).signatures());
    expect(new OperationRegistry([definition(2)]).signatures()).toEqual(['noop@2']);
    // Definitions without a version hash as before versions existed, so older peers can still join.
    expect(hash(1)).toBe(hash());
    expect(hash(1)).toBe(registryHash(['noop']));
    expect(hash(2)).not.toBe(hash(1));
  });
});
