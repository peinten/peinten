import { deflateSync, inflateSync } from 'fflate';
import * as v from 'valibot';
import type { FilterSpec } from '../filters/filter.ts';
import { textLayerDataSchema } from '../text/schema.ts';
import type { TextLayerData } from '../text/text-layer.ts';
import { FIX15_ONE, isUniformTile, MASK_TILE_LENGTH, RGBA_TILE_LENGTH, tileCoords, tileKey } from '../tiles/tile.ts';
import type { TileMap } from '../tiles/tile-map.ts';
import type { BlendMode } from './blend-mode.ts';
import type { ClientId, DocNode, NodeId } from './nodes.ts';
import { blendModeSchema, filterSpecSchema, nameSchema, nodeIdSchema, opacitySchema } from './schema.ts';
import type { DocState } from './state.ts';

/** A deflated tile. Data is the fix15 samples as little-endian bytes, which typed arrays use on every target platform. */
interface SerializedTile {
  readonly x: number;
  readonly y: number;
  readonly data: Uint8Array;
}

interface SerializedNodeBase {
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly mask?: { readonly tiles: readonly SerializedTile[]; readonly fill: 0 | 1; readonly enabled: boolean };
}

type SerializedNode =
  | (SerializedNodeBase & {
      readonly kind: 'paint';
      readonly locked: boolean;
      readonly alphaLocked: boolean;
      readonly tiles: readonly SerializedTile[];
    })
  | (SerializedNodeBase & {
      readonly kind: 'group';
      readonly locked: boolean;
      readonly passThrough: boolean;
      readonly childIds: readonly NodeId[];
    })
  | (SerializedNodeBase & { readonly kind: 'adjustment'; readonly filter: FilterSpec })
  | (SerializedNodeBase & { readonly kind: 'text'; readonly locked: boolean; readonly text: TextLayerData });

/**
 * The document file format, shared by saved files and collaboration snapshots.
 * Derived data (text rasters, thumbnails, GPU caches) and history are not stored.
 */
export interface SerializedDocument {
  readonly format: 'peinten';
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly rootIds: readonly NodeId[];
  readonly nodes: Readonly<Record<NodeId, SerializedNode>>;
  /** Only in collaboration snapshots: other clients' selections clip their later strokes. */
  readonly selections?: Readonly<Record<ClientId, readonly SerializedTile[]>>;
}

const tileCoordSchema = v.pipe(v.number(), v.integer(), v.minValue(-32768), v.maxValue(32767));
const tilesSchema = v.array(v.object({ x: tileCoordSchema, y: tileCoordSchema, data: v.instance(Uint8Array) }));
const nodeBase = {
  name: nameSchema,
  visible: v.boolean(),
  opacity: opacitySchema,
  blendMode: blendModeSchema,
  mask: v.optional(v.object({ tiles: tilesSchema, fill: v.picklist([0, 1]), enabled: v.boolean() })),
};
const sizeSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65536));

const documentSchema = v.object({
  format: v.literal('peinten'),
  version: v.literal(1),
  width: sizeSchema,
  height: sizeSchema,
  rootIds: v.array(nodeIdSchema),
  nodes: v.record(
    nodeIdSchema,
    v.variant('kind', [
      v.object({
        ...nodeBase,
        kind: v.literal('paint'),
        locked: v.boolean(),
        alphaLocked: v.boolean(),
        tiles: tilesSchema,
      }),
      v.object({
        ...nodeBase,
        kind: v.literal('group'),
        locked: v.boolean(),
        passThrough: v.boolean(),
        childIds: v.array(nodeIdSchema),
      }),
      v.object({ ...nodeBase, kind: v.literal('adjustment'), filter: filterSpecSchema }),
      v.object({ ...nodeBase, kind: v.literal('text'), locked: v.boolean(), text: textLayerDataSchema }),
    ]),
  ),
  selections: v.optional(v.record(v.string(), tilesSchema)),
});

function encodeTiles(tiles: TileMap): SerializedTile[] {
  return [...tiles].map(([key, tile]) => {
    const [x, y] = tileCoords(key);
    // Deflating each tile on its own keeps empty and flat tiles tiny and lets readers inflate tiles independently.
    return { x, y, data: deflateSync(new Uint8Array(tile.buffer, tile.byteOffset, tile.byteLength)) };
  });
}

/** `fill` is the value of missing tiles; tiles holding only that value are dropped. */
function decodeTiles(tiles: readonly SerializedTile[], length: number, fill = 0): Map<number, Uint16Array> {
  const result = new Map<number, Uint16Array>();
  for (const { x, y, data } of tiles) {
    const bytes = inflateSync(data);
    if (bytes.byteLength !== length * 2) throw new Error(`Tile ${x},${y} has ${bytes.byteLength} bytes`);
    // Copy into a fresh buffer: inflated output may not be 2-byte aligned.
    const tile = new Uint16Array(length);
    new Uint8Array(tile.buffer).set(bytes);
    if (!isUniformTile(tile, fill)) result.set(tileKey(x, y), tile);
  }
  return result;
}

function serializeNode(node: DocNode): SerializedNode {
  const base = {
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    blendMode: node.blendMode,
    ...(node.mask && {
      mask: { tiles: encodeTiles(node.mask.tiles), fill: node.mask.fill, enabled: node.mask.enabled },
    }),
  };
  switch (node.kind) {
    case 'paint':
      return {
        ...base,
        kind: 'paint',
        locked: node.locked,
        alphaLocked: node.alphaLocked,
        tiles: encodeTiles(node.tiles),
      };
    case 'group':
      return { ...base, kind: 'group', locked: node.locked, passThrough: node.passThrough, childIds: node.childIds };
    case 'adjustment':
      return { ...base, kind: 'adjustment', filter: node.filter };
    case 'text':
      return { ...base, kind: 'text', locked: node.locked, text: node.text };
  }
}

/** Converts a state into the file format. Selections are included only for collaboration snapshots. */
export function serializeDocument(state: DocState, options: { readonly selections: boolean }): SerializedDocument {
  return {
    format: 'peinten',
    version: 1,
    width: state.width,
    height: state.height,
    rootIds: state.rootIds,
    nodes: Object.fromEntries([...state.nodes].map(([id, node]) => [id, serializeNode(node)])),
    ...(options.selections && {
      selections: Object.fromEntries([...state.selections].map(([id, mask]) => [id, encodeTiles(mask)])),
    }),
  };
}

/**
 * Validates untrusted file contents and rebuilds the state.
 * Throws when the data does not match the schema or the layer tree is not a proper tree.
 */
export function deserializeDocument(input: unknown, filters: { parse(input: unknown): FilterSpec }): DocState {
  const doc = v.parse(documentSchema, input);
  const nodes = new Map<NodeId, DocNode>();
  const visit = (ids: readonly NodeId[], parentId: NodeId | null) => {
    for (const id of ids) {
      const source = doc.nodes[id];
      if (!source) throw new Error(`Missing node ${id}`);
      if (nodes.has(id)) throw new Error(`Node ${id} appears more than once`);
      const base = {
        id,
        parentId,
        name: source.name,
        visible: source.visible,
        opacity: source.opacity,
        blendMode: source.blendMode,
        ...(source.mask && {
          mask: {
            tiles: decodeTiles(source.mask.tiles, MASK_TILE_LENGTH, source.mask.fill * FIX15_ONE),
            fill: source.mask.fill,
            enabled: source.mask.enabled,
          },
        }),
      };
      switch (source.kind) {
        case 'paint':
          nodes.set(id, {
            ...base,
            kind: 'paint',
            locked: source.locked,
            alphaLocked: source.alphaLocked,
            tiles: decodeTiles(source.tiles, RGBA_TILE_LENGTH),
          });
          break;
        case 'group':
          nodes.set(id, {
            ...base,
            kind: 'group',
            locked: source.locked,
            passThrough: source.passThrough,
            childIds: source.childIds,
          });
          visit(source.childIds, id);
          break;
        case 'adjustment':
          nodes.set(id, { ...base, kind: 'adjustment', filter: filters.parse(source.filter) });
          break;
        case 'text':
          nodes.set(id, { ...base, kind: 'text', locked: source.locked, text: source.text });
          break;
      }
    }
  };
  visit(doc.rootIds, null);
  if (nodes.size !== Object.keys(doc.nodes).length) throw new Error('The document contains unreachable nodes');
  const selections = new Map(
    Object.entries(doc.selections ?? {}).map(([id, tiles]) => [id, decodeTiles(tiles, MASK_TILE_LENGTH)]),
  );
  return { width: doc.width, height: doc.height, nodes, rootIds: doc.rootIds, selections };
}
