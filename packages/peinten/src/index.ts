// Public API of peinten (main-thread runtime, operations, brushes, tools).

import type { PaintRuntime } from './application/api.ts';
import type { AnyTool } from './application/tool.ts';
import { composeRuntime, type RuntimeOptions } from './compose.ts';
import { MainThreadRuntime } from './infrastructure/main-thread.ts';

/** Creates a runtime on the current thread. For a worker-hosted runtime see `peinten/worker`. */
export async function createRuntime<T extends readonly AnyTool[]>(
  options: RuntimeOptions<T>,
): Promise<PaintRuntime<T>> {
  return new MainThreadRuntime(await composeRuntime(options));
}

export type {
  CreateDocumentOptions,
  CreateViewOptions,
  PaintDocument,
  PaintRuntime,
  PaintView,
  RuntimeSnapshot,
  SnapshotSource,
} from './application/api.ts';
export type {
  Exporter,
  ExportLayer,
  ExportSource,
  PlacedImage,
  RasterImage,
} from './application/export.ts';
export type {
  HandleStyle,
  LineStyle,
  OverlayShape,
  OverlaySpace,
  PolygonStyle,
} from './application/overlay.ts';
export type { ViewBackground, WarpPreview } from './application/ports/renderer.ts';
export type {
  FontHandle,
  FontProvider,
  PositionedGlyph,
  TextEngine,
  TextLayout,
  TextRasterImage,
} from './application/ports/text.ts';
export type { DocumentSnapshot, NodeSnapshot, Thumbnail } from './application/snapshot.ts';
export type {
  AnyTool,
  ITool,
  Modifiers,
  OverlayBuilder,
  OverlayColor,
  PointerInput,
  StrokeHandle,
  ToolCommand,
  ToolContext,
  ToolDocument,
  ToolId,
  ToolKeyEvent,
  ToolOptions,
  ToolPointerEvent,
  ToolSnapshot,
  ToolUIState,
} from './application/tool.ts';
export type { ViewSnapshot } from './application/view.ts';
export type { CanvasSize, Viewport } from './application/viewport.ts';
export { documentToScreen } from './application/viewport.ts';
export { type CustomFilter, defineFilter, type RuntimeOptions } from './compose.ts';

export { type ColorMixer, libMyPaintPigmentMixer } from './domain/brush/color-mixer.ts';
export { type ParsedMyb, parseMyb, serializeMyb } from './domain/brush/myb.ts';
export { presets } from './domain/brush/presets.ts';
export { type BrushResources, brushColor, brushSize, resolveBrush } from './domain/brush/resolve-brush.ts';
export {
  type BrushInputId,
  type BrushSettingId,
  type BrushSettings,
  type BrushSettingValue,
  baseValueOf,
  DEFAULT_BRUSH,
  type MappingPoint,
  withBaseValues,
} from './domain/brush/settings.ts';
export { BRUSH_INPUT_INFO, BRUSH_SETTING_INFO } from './domain/brush/settings-data.ts';
export { previewStrokeSamples, SAMPLE_STRIDE, type StrokeSample } from './domain/brush/stroke-samples.ts';
export { BLEND_MODES, type BlendMode } from './domain/document/blend-mode.ts';
export type { ClientId, DocNode, NodeId, NodeKind, NodeProps } from './domain/document/nodes.ts';
export { SELECTION_MODES, type SelectionMode } from './domain/document/selection.ts';
export type { DocState } from './domain/document/state.ts';
export type { FilterDefinition, FilterParamsMap, FilterSpec, FilterType } from './domain/filters/filter.ts';
export { type Affine2D, IDENTITY_AFFINE } from './domain/geometry/affine.ts';
export type { FilterExecutor, OpContext, PrepareContext, TextRasterizer } from './domain/ops/context.ts';
export { ops } from './domain/ops/factories.ts';
export {
  type AnyOperationDefinition,
  defineOperation,
  type Operation,
  OperationConflictError,
  type OperationDefinition,
  type OperationDraft,
} from './domain/ops/operation.ts';
export type { SelectionShape } from './domain/ops/selection-ops.ts';
export type { StrokeTarget } from './domain/ops/stroke-renderer.ts';
export type { WarpMesh } from './domain/raster/warp.ts';
export {
  applyStyle,
  DEFAULT_TEXT_STYLE,
  plainText,
  replaceText,
  type TextFrame,
  type TextLayerData,
  type TextParagraph,
  type TextRun,
  type TextStyle,
  type WritingMode,
} from './domain/text/text-layer.ts';
export type { Rect } from './domain/tiles/tile-map.ts';
export { importImage } from './infrastructure/image-import.ts';
export { CanvasFontProvider, CanvasTextEngine } from './infrastructure/text-canvas/canvas-text-engine.ts';
export type { FilterKernel, FilterKernelArgs } from './infrastructure/webgpu/filter-pass.ts';
