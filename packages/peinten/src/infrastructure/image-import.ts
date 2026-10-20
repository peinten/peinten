import type { NodeId } from '../domain/document/nodes.ts';
import { ops } from '../domain/ops/factories.ts';
import type { AddLayerDraft } from '../domain/ops/node-ops.ts';
import type { PutTilesDraft } from '../domain/ops/raster-ops.ts';

/**
 * Builds the drafts that add a new layer containing `image`. Dispatch them together so one undo removes the layer.
 * Decoding happens here, on the issuing side, so the pixels travel in the operation.
 */
export async function importImage(
  image: ImageBitmap | Blob,
  placement: {
    readonly parentId?: NodeId | null;
    readonly index?: number;
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
  } = {},
): Promise<[AddLayerDraft, PutTilesDraft]> {
  const bitmap = image instanceof Blob ? await createImageBitmap(image) : image;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const layer = ops.addLayer({ parentId: placement.parentId, index: placement.index, name: placement.name ?? 'Image' });
  const put = ops.putPixels({
    nodeId: layer.nodeId,
    x: placement.x ?? 0,
    y: placement.y ?? 0,
    width: pixels.width,
    height: pixels.height,
    data: pixels.data,
  });
  return [layer, put];
}
