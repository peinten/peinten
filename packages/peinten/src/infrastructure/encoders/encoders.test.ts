import { describe, expect, it } from 'vitest';
import { hashTiles, opContext, richDoc } from '../../../test/helpers.ts';
import type { DocNode } from '../../domain/document/nodes.ts';
import { deserializeDocument, serializeDocument } from '../../domain/document/serialization.ts';
import type { DocState } from '../../domain/document/state.ts';
import { cborDocumentCodec } from './cbor-document-codec.ts';

function summarize(state: DocState) {
  const node = (n: DocNode) => ({ ...n, ...(n.kind === 'paint' && { tiles: hashTiles(n.tiles) }) });
  return { ...state, nodes: [...state.nodes.values()].map(node), selections: [...state.selections.keys()] };
}

describe('document files', () => {
  it('round-trips every node kind through CBOR', async () => {
    const state = await richDoc();
    const bytes = cborDocumentCodec.encode(serializeDocument(state, { selections: false }));
    expect([...bytes.slice(0, 3)]).toEqual([0xd9, 0xd9, 0xf7]);
    const restored = deserializeDocument(cborDocumentCodec.decode(bytes), opContext.filters);
    expect(summarize(restored)).toEqual({ ...summarize(state), selections: [] });
  });

  it('keeps selections only in collaboration snapshots', async () => {
    const state = await richDoc();
    const bytes = cborDocumentCodec.encode(serializeDocument(state, { selections: true }));
    const restored = deserializeDocument(cborDocumentCodec.decode(bytes), opContext.filters);
    expect(hashTiles(restored.selections.get('me')!)).toBe(hashTiles(state.selections.get('me')!));
  });

  it('rejects malformed files', async () => {
    const valid = serializeDocument(await richDoc(), { selections: false });
    const group = Object.entries(valid.nodes).find(([, n]) => n.kind === 'group')!;
    const cyclic = { ...valid, nodes: { ...valid.nodes, [group[0]]: { ...group[1], childIds: [group[0]] } } };
    const orphan = { ...valid, rootIds: valid.rootIds.slice(1) };
    const badFilter = {
      ...valid,
      nodes: Object.fromEntries(
        Object.entries(valid.nodes).map(([id, n]) => [
          id,
          n.kind === 'adjustment' ? { ...n, filter: { type: 'nope' } } : n,
        ]),
      ),
    };
    for (const input of [cyclic, orphan, badFilter, { ...valid, version: 2 }, 'garbage'])
      expect(() => deserializeDocument(input, opContext.filters)).toThrow();
    expect(() => cborDocumentCodec.decode(new Uint8Array([0xff, 0x00, 0x13]))).toThrow();
  });
});
