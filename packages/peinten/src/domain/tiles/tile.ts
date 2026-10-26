/** Edge length of a square tile in pixels. Matches libmypaint's tile size. */
export const TILE_SIZE = 64;

/** 1.0 in fix15, the 16-bit fixed point that tiles store: values run from 0 to this. */
export const FIX15_ONE = 1 << 15;

/** Number of 16-bit values in an RGBA tile. */
export const RGBA_TILE_LENGTH = TILE_SIZE * TILE_SIZE * 4;

/** Number of 16-bit values in a single-channel mask tile. */
export const MASK_TILE_LENGTH = TILE_SIZE * TILE_SIZE;

/** Premultiplied RGBA pixels in fix15. Never mutated once it is part of a committed state. */
export type RgbaTile = Uint16Array;

/** Single-channel coverage in fix15. Never mutated once it is part of a committed state. */
export type MaskTile = Uint16Array;

/** Packed tile coordinate usable as a Map key. Supports coordinates in [-32768, 32767]. */
export type TileKey = number;

const OFFSET = 32768;
const SPAN = 65536;

/** Packs tile coordinates into a single number. */
export function tileKey(tx: number, ty: number): TileKey {
  return (ty + OFFSET) * SPAN + (tx + OFFSET);
}

/** Unpacks a tile key into tile coordinates. */
export function tileCoords(key: TileKey): readonly [number, number] {
  return [(key % SPAN) - OFFSET, Math.floor(key / SPAN) - OFFSET];
}
/** Returns true when every value of the tile equals `value`, the implicit value of a missing tile. */
export function isUniformTile(tile: Uint16Array, value: number): boolean {
  if (value === 0) return isEmptyTile(tile);
  for (let i = 0; i < tile.length; i++) if (tile[i] !== value) return false;
  return true;
}

/** Returns true when every value of the tile is zero, so the tile can be dropped from sparse storage. */
export function isEmptyTile(tile: Uint16Array): boolean {
  // Compare 32 bits at a time; tiles are always 4-byte aligned.
  const words = new Uint32Array(tile.buffer, tile.byteOffset, tile.length >> 1);
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 0) return false;
  }
  return true;
}
