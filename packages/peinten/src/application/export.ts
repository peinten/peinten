import type { BlendMode } from '../domain/document/blend-mode.ts';
import type { NodeId } from '../domain/document/nodes.ts';
import { type DocState, getNode } from '../domain/document/state.ts';
import { contentBounds } from '../domain/raster/bounds.ts';
import { tilesToRgba8 } from '../domain/raster/pixels.ts';
import type { TextLayerData } from '../domain/text/text-layer.ts';
import { intersectRect, type TileMap } from '../domain/tiles/tile-map.ts';

/** Straight 8-bit RGBA. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A raster placed in document pixels. */
export interface PlacedImage extends RasterImage {
  readonly x: number;
  readonly y: number;
}

interface ExportLayerBase {
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
}

/** A layer as file formats see it. Children are ordered bottom to top, like the document. */
export type ExportLayer =
  | (ExportLayerBase & { readonly kind: 'pixels'; readonly image: PlacedImage | null })
  | (ExportLayerBase & {
      readonly kind: 'group';
      readonly passThrough: boolean;
      readonly children: readonly ExportLayer[];
    })
  | (ExportLayerBase & { readonly kind: 'text'; readonly text: TextLayerData; readonly image: PlacedImage | null });

/** What an exporter can read from a document. Reads happen on demand, so an exporter pays only for what it uses. */
export interface ExportSource {
  readonly width: number;
  readonly height: number;
  /** The rendered document, without previews or an unfinished stroke. */
  composite(): Promise<RasterImage>;
  /**
   * The layer tree, bottom to top. File formats do not know peinten's filters, so a folder containing adjustment
   * layers becomes its rendered pixels, and the whole document becomes one layer when the root contains one.
   */
  layers(): Promise<readonly ExportLayer[]>;
}

/** Turns a document into a file. `peinten/exporting` has exporters for PNG, JPEG and PSD. */
export type Exporter = (source: ExportSource) => Promise<Blob>;

/** What exporting needs from the renderer. The renderer must already show `state` without previews. */
interface ExportReader {
  readonly state: DocState;
  readComposite(): Promise<Uint8ClampedArray>;
  readGroup(groupId: NodeId): Promise<Uint8ClampedArray>;
  textRaster(id: NodeId): TileMap | undefined;
}

function placeTiles(tiles: TileMap, state: DocState): PlacedImage | null {
  const bounds = contentBounds(tiles, 4);
  const rect = bounds && intersectRect(bounds, { x: 0, y: 0, width: state.width, height: state.height });
  return rect && { ...rect, data: tilesToRgba8(tiles, rect) };
}

/** PSD has no blur adjustment, so a scope containing adjustment layers is exported as its rendered result. */
function hasAdjustment(state: DocState, ids: readonly NodeId[]): boolean {
  return ids.some((id) => getNode(state, id).kind === 'adjustment');
}

async function exportLayers(source: ExportReader, ids: readonly NodeId[]): Promise<ExportLayer[]> {
  const { state } = source;
  const layers: ExportLayer[] = [];
  for (const id of ids) {
    const node = getNode(state, id);
    const base = { name: node.name, visible: node.visible, opacity: node.opacity, blendMode: node.blendMode };
    switch (node.kind) {
      case 'paint':
        layers.push({ ...base, kind: 'pixels', image: placeTiles(node.tiles, state) });
        break;
      case 'text':
        layers.push({
          ...base,
          kind: 'text',
          text: node.text,
          image: placeTiles(source.textRaster(id) ?? new Map(), state),
        });
        break;
      case 'group':
        if (hasAdjustment(state, node.childIds)) {
          const data = await source.readGroup(id);
          layers.push({
            ...base,
            kind: 'pixels',
            image: { x: 0, y: 0, width: state.width, height: state.height, data },
          });
        } else {
          layers.push({
            ...base,
            kind: 'group',
            passThrough: node.passThrough,
            children: await exportLayers(source, node.childIds),
          });
        }
        break;
      case 'adjustment':
        // Unreachable: scopes with adjustment layers are exported as pixels by the caller.
        break;
    }
  }
  return layers;
}

/** Reads `reader` on demand. The composite is read once, because the merged root layer reuses it. */
export function createExportSource(reader: ExportReader): ExportSource {
  const { state } = reader;
  let composite: Promise<RasterImage> | null = null;
  const source: ExportSource = {
    width: state.width,
    height: state.height,
    composite() {
      composite ??= reader.readComposite().then((data) => ({ width: state.width, height: state.height, data }));
      return composite;
    },
    async layers() {
      if (!hasAdjustment(state, state.rootIds)) return exportLayers(reader, state.rootIds);
      const image = await source.composite();
      return [
        {
          name: 'Merged',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          kind: 'pixels',
          image: { ...image, x: 0, y: 0 },
        },
      ];
    },
  };
  return source;
}
