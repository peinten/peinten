import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { createDocState, type DocState, getNode } from '../document/state.ts';
import { defineOperation, type Operation, OperationConflictError } from '../ops/operation.ts';
import { type Batch, Timeline } from './timeline.ts';

/** Appends a letter to the first layer's name. Order-sensitive, which makes rebase bugs visible. */
const appendOp = defineOperation<{ type: 'append'; letter: string }>({
  type: 'append',
  schema: v.object({ letter: v.string() }),
  apply(state, op) {
    if (op.letter === '!') throw new OperationConflictError('conflict');
    const layer = getNode(state, 'L');
    const nodes = new Map(state.nodes);
    nodes.set('L', { ...layer, name: layer.name + op.letter });
    return { ...state, nodes };
  },
});

let seq = 0;
function batch(clientId: string, ...letters: string[]): Batch {
  const id = `b${seq++}`;
  return {
    id,
    clientId,
    ops: letters.map((letter, i) => ({ type: 'append', letter, id: `${id}-${i}`, clientId }) as Operation),
  };
}
function toggle(clientId: string, target: Batch, enabled: boolean): Batch {
  const id = `t${seq++}`;
  return { id, clientId, ops: [{ type: 'set-op-enabled', batchId: target.id, enabled, id, clientId } as Operation] };
}
function name(state: DocState): string {
  return getNode(state, 'L').name;
}
function timeline(limit = 100) {
  const initial = createDocState(64, 64, 'L');
  const base = { ...initial, nodes: new Map([['L', { ...getNode(initial, 'L'), name: '' }]]) };
  return new Timeline(base, { apply: (s, op) => appendOp.apply(s, op as never, {} as never), limit });
}

describe('Timeline', () => {
  it('applies local batches optimistically and keeps them on commit', async () => {
    const t = timeline();
    const a = batch('me', 'a');
    await t.local(a);
    expect(name(t.state)).toBe('a');
    expect(name(t.confirmedState)).toBe('');
    await t.commit(a);
    expect(name(t.confirmedState)).toBe('a');
  });

  it('rebases pending batches on top of a peer commit', async () => {
    const t = timeline();
    const mine = batch('me', 'm');
    await t.local(mine);
    await t.commit(batch('peer', 'p'));
    expect(name(t.state)).toBe('pm');
    await t.commit(mine);
    expect(name(t.confirmedState)).toBe('pm');
  });

  it('disables and re-enables a batch in the middle of the log', async () => {
    const t = timeline();
    const a = batch('me', 'a');
    const b = batch('me', 'b');
    await t.commit(a);
    await t.commit(b);
    await t.commit(batch('peer', 'c'));
    await t.commit(toggle('me', b, false));
    expect(name(t.state)).toBe('ac');
    await t.commit(toggle('me', b, true));
    expect(name(t.state)).toBe('abc');
  });

  it('skips a whole batch when one of its operations conflicts', async () => {
    const t = timeline();
    await t.commit(batch('me', 'a', '!', 'b'));
    expect(name(t.state)).toBe('');
  });

  it('drops rejected pending batches', async () => {
    const t = timeline();
    const a = batch('me', 'a');
    await t.local(a);
    await t.local(batch('me', 'b'));
    await t.reject(a.id);
    expect(name(t.state)).toBe('b');
  });

  it('reports toggles that target batches outside the retained window', async () => {
    const t = timeline(1);
    const a = batch('me', 'a');
    await t.commit(a);
    await t.commit(batch('me', 'b'));
    expect(t.has(a.id)).toBe(false);
    expect(await t.commit(toggle('me', a, false))).toBe(false);
    expect(name(t.state)).toBe('ab');
  });

  it('reuses the precomputed state of a live stroke', async () => {
    const t = timeline();
    const precomputed = createDocState(1, 1, 'L');
    await t.local(batch('me', 'x'), precomputed);
    expect(t.state).toBe(precomputed);
  });
});
