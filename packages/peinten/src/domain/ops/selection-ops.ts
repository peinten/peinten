import * as v from 'valibot';
import type { NodeId } from '../document/nodes.ts';
import { nodeIdSchema } from '../document/schema.ts';
import {
  combineSelection,
  invertMask,
  SELECTION_MODES,
  type SelectionMode,
  selectAllMask,
} from '../document/selection.ts';
import type { DocState } from '../document/state.ts';
import { floodSelect } from '../raster/flood-fill.ts';
import { ellipsePolygon, rasterizePolygon } from '../raster/polygon.ts';
import { type MaskMap, translateTiles } from '../tiles/tile-map.ts';
import { defineOperation, OperationConflictError } from './operation.ts';

const finite = v.pipe(v.number(), v.finite());
const modeSchema = v.picklist(SELECTION_MODES);

/** Sets the client's selection; an empty mask means no selection. */
function withSelection(state: DocState, clientId: string, mask: MaskMap | null): DocState {
  const selections = new Map(state.selections);
  if (mask?.size) selections.set(clientId, mask);
  else selections.delete(clientId);
  return { ...state, selections };
}

const bounds = (state: DocState) => ({ x: 0, y: 0, width: state.width, height: state.height });

export type SelectionShape =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }
  /** Flat [x0, y0, x1, y1, ...]; used by lasso and polygon selection. */
  | { readonly kind: 'polygon'; readonly points: readonly number[] };

export interface SelectShapeDraft {
  readonly type: 'select-shape';
  readonly mode: SelectionMode;
  readonly shape: SelectionShape;
  readonly antialias: boolean;
}

function shapePolygon(shape: SelectionShape): readonly number[] {
  switch (shape.kind) {
    case 'rect':
      return [
        shape.x,
        shape.y,
        shape.x + shape.width,
        shape.y,
        shape.x + shape.width,
        shape.y + shape.height,
        shape.x,
        shape.y + shape.height,
      ];
    case 'ellipse':
      return ellipsePolygon(shape.cx, shape.cy, shape.rx, shape.ry);
    case 'polygon':
      return shape.points;
  }
}

export const selectShapeOp = defineOperation<SelectShapeDraft>({
  type: 'select-shape',
  schema: v.object({
    mode: modeSchema,
    shape: v.variant('kind', [
      v.object({ kind: v.literal('rect'), x: finite, y: finite, width: finite, height: finite }),
      v.object({ kind: v.literal('ellipse'), cx: finite, cy: finite, rx: finite, ry: finite }),
      v.object({ kind: v.literal('polygon'), points: v.pipe(v.array(finite), v.maxLength(200_000)) }),
    ]),
    antialias: v.boolean(),
  }),
  apply(state, op) {
    const mask = rasterizePolygon(shapePolygon(op.shape), bounds(state), op.antialias);
    return withSelection(
      state,
      op.clientId,
      combineSelection(state.selections.get(op.clientId) ?? null, mask, op.mode),
    );
  },
});

export interface SelectWandDraft {
  readonly type: 'select-wand';
  readonly mode: SelectionMode;
  readonly nodeId: NodeId;
  readonly x: number;
  readonly y: number;
  readonly tolerance: number;
  readonly contiguous: boolean;
}

export const selectWandOp = defineOperation<SelectWandDraft>({
  type: 'select-wand',
  schema: v.object({
    mode: modeSchema,
    nodeId: nodeIdSchema,
    x: finite,
    y: finite,
    tolerance: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    contiguous: v.boolean(),
  }),
  apply(state, op) {
    // Only paint layers have deterministic pixels on every peer; text rendering differs between environments.
    const layer = state.nodes.get(op.nodeId);
    if (layer?.kind !== 'paint') throw new OperationConflictError('The magic wand samples paint layers only');
    const mask = floodSelect(layer.tiles, {
      width: state.width,
      height: state.height,
      x: op.x,
      y: op.y,
      tolerance: op.tolerance,
      contiguous: op.contiguous,
    });
    return withSelection(
      state,
      op.clientId,
      combineSelection(state.selections.get(op.clientId) ?? null, mask, op.mode),
    );
  },
});

export const selectAllOp = defineOperation<{ readonly type: 'select-all' }>({
  type: 'select-all',
  schema: v.object({}),
  apply: (state, op) => withSelection(state, op.clientId, selectAllMask(bounds(state))),
});

export const deselectOp = defineOperation<{ readonly type: 'deselect' }>({
  type: 'deselect',
  schema: v.object({}),
  apply: (state, op) => withSelection(state, op.clientId, null),
});

export const invertSelectionOp = defineOperation<{ readonly type: 'invert-selection' }>({
  type: 'invert-selection',
  schema: v.object({}),
  apply: (state, op) =>
    withSelection(state, op.clientId, invertMask(state.selections.get(op.clientId) ?? null, bounds(state))),
});

/** Moves the issuing client's selection outline by whole pixels; pixels themselves stay put. */
export interface MoveSelectionDraft {
  readonly type: 'move-selection';
  readonly dx: number;
  readonly dy: number;
}

const offsetSchema = v.pipe(v.number(), v.integer(), v.minValue(-65536), v.maxValue(65536));

export const moveSelectionOp = defineOperation<MoveSelectionDraft>({
  type: 'move-selection',
  schema: v.object({ dx: offsetSchema, dy: offsetSchema }),
  apply: (state, op) => {
    const mask = state.selections.get(op.clientId);
    if (!mask) return state;
    return withSelection(state, op.clientId, translateTiles(mask, op.dx, op.dy, bounds(state), 1));
  },
});
