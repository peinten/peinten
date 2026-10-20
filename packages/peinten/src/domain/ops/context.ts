import type { ColorMixer } from '../brush/color-mixer.ts';
import type { ClientId, TextLayer } from '../document/nodes.ts';
import type { DocState } from '../document/state.ts';
import type { FilterRegistry, FilterSpec } from '../filters/filter.ts';
import type { MaskMap, Rect, TileMap } from '../tiles/tile-map.ts';

/** Port to the device that runs filter kernels. Implemented on the GPU in infrastructure. */
export interface FilterExecutor {
  /**
   * Returns `tiles` with the filter applied inside `region`. Pixels outside `bounds` (the document) read as
   * transparent. When `mask` is given, the result is blended with the input by the mask coverage.
   */
  apply(input: {
    tiles: TileMap;
    region: Rect;
    bounds: Rect;
    filter: FilterSpec;
    mask: MaskMap | null;
  }): Promise<TileMap>;
}

/** Port that renders a text layer into tiles. Implemented with Canvas2D or fontkit in infrastructure. */
export interface TextRasterizer {
  rasterize(layer: TextLayer): Promise<TileMap>;
}

/** Resources available to `apply`. Identical on every peer so results stay deterministic. */
export interface OpContext {
  readonly mixer: ColorMixer;
  readonly filters: FilterRegistry;
  readonly filterExecutor: FilterExecutor;
}

/** Resources available to `prepare`, which only runs on the issuing client. */
export interface PrepareContext {
  readonly state: DocState;
  readonly clientId: ClientId;
  readonly text: TextRasterizer;
}
