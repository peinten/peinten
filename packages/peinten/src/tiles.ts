/**
 * peinten/tiles: helpers for custom operations that read and write layer pixels. Layers store premultiplied RGBA and
 * selections store coverage, both in fix15 64×64 tiles. Free of DOM and GPU dependencies, like `apply` itself.
 */
export { contentBounds } from './domain/raster/bounds.ts';
export { type FloodOptions, floodSelect } from './domain/raster/flood-fill.ts';
export { rgba8ToTiles, tilesToRgba8 } from './domain/raster/pixels.ts';
export {
  FIX15_ONE,
  isEmptyTile,
  MASK_TILE_LENGTH,
  type MaskTile,
  RGBA_TILE_LENGTH,
  type RgbaTile,
  TILE_SIZE,
  type TileKey,
  tileCoords,
  tileKey,
} from './domain/tiles/tile.ts';
export {
  forEachTileInRect,
  type MaskMap,
  type Rect,
  type TileMap,
  tileKeysInRect,
  translateTiles,
} from './domain/tiles/tile-map.ts';
