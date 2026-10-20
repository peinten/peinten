import { setOpEnabledOp } from '../history/toggle.ts';
import { resizeCanvasOp } from './canvas-ops.ts';
import { applyFilterOp } from './filter-ops.ts';
import {
  addAdjustmentLayerOp,
  addGroupOp,
  addLayerOp,
  addTextLayerOp,
  duplicateNodeOp,
  moveNodeOp,
  removeNodeOp,
  updateNodeOp,
  updateTextOp,
} from './node-ops.ts';
import type { AnyOperationDefinition } from './operation.ts';
import { clearOp, putTilesOp, strokeOp } from './raster-ops.ts';
import {
  deselectOp,
  invertSelectionOp,
  moveSelectionOp,
  selectAllOp,
  selectShapeOp,
  selectWandOp,
} from './selection-ops.ts';
import { rasterizeNodeOp } from './text-ops.ts';
import { warpOp } from './transform-ops.ts';

/** Operations every peer understands. Custom operations are registered next to these. */
export const coreOperations: readonly AnyOperationDefinition[] = [
  addLayerOp,
  addGroupOp,
  addAdjustmentLayerOp,
  addTextLayerOp,
  removeNodeOp,
  moveNodeOp,
  updateNodeOp,
  updateTextOp,
  duplicateNodeOp,
  strokeOp,
  clearOp,
  putTilesOp,
  resizeCanvasOp,
  warpOp,
  applyFilterOp,
  rasterizeNodeOp,
  selectShapeOp,
  selectWandOp,
  selectAllOp,
  deselectOp,
  invertSelectionOp,
  moveSelectionOp,
  setOpEnabledOp,
];
