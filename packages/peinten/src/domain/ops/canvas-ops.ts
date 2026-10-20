import * as v from 'valibot';
import type { ClientId, DocNode, NodeId, SelectionMask } from '../document/nodes.ts';
import { MAX_DOCUMENT_SIZE } from '../document/state.ts';
import type { Affine2D } from '../geometry/affine.ts';
import { translateTiles } from '../tiles/tile-map.ts';
import { defineOperation } from './operation.ts';

export interface ResizeCanvasDraft {
  readonly type: 'resize-canvas';
  readonly width: number;
  readonly height: number;
  /** Where the old top-left corner lands on the new canvas; negative values crop from the top left. */
  readonly offsetX: number;
  readonly offsetY: number;
}

const size = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_DOCUMENT_SIZE));
const offset = v.pipe(v.number(), v.integer(), v.minValue(-MAX_DOCUMENT_SIZE), v.maxValue(MAX_DOCUMENT_SIZE));

/**
 * Changes the canvas size, moving every layer and selection by the offset. Pixels outside the new canvas are
 * dropped; undo brings them back from history. Text layers move by their transform and are rendered again.
 */
export const resizeCanvasOp = defineOperation<ResizeCanvasDraft>({
  type: 'resize-canvas',
  schema: v.object({ width: size, height: size, offsetX: offset, offsetY: offset }),
  apply(state, op) {
    const { width, height, offsetX: dx, offsetY: dy } = op;
    const bounds = { x: 0, y: 0, width, height };
    const nodes = new Map<NodeId, DocNode>();
    for (const [id, node] of state.nodes) {
      if (node.kind === 'paint') nodes.set(id, { ...node, tiles: translateTiles(node.tiles, dx, dy, bounds, 4) });
      else if (node.kind === 'text') {
        const [a, b, c, d, e, f] = node.text.transform;
        const transform: Affine2D = [a, b, c, d, e + dx, f + dy];
        nodes.set(id, { ...node, text: { ...node.text, transform } });
      } else nodes.set(id, node);
    }
    const selections = new Map<ClientId, SelectionMask>();
    for (const [clientId, mask] of state.selections) {
      const moved = translateTiles(mask, dx, dy, bounds, 1);
      if (moved.size) selections.set(clientId, moved);
    }
    return { ...state, width, height, nodes, selections };
  },
});
