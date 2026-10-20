import {
  BrushTool,
  ColorPickerTool,
  LassoSelectTool,
  PanTool,
  PolygonSelectTool,
  RotateTool,
  ShapeSelectTool,
  TextTool,
  TransformTool,
  WandSelectTool,
  ZoomTool,
} from 'peinten/tools';

/** Tools of the demo. Instantiated in the worker; the main thread only uses the type. */
export const createTools = () =>
  [
    new BrushTool(),
    new BrushTool({ id: 'eraser', eraser: true }),
    new ColorPickerTool(),
    new ShapeSelectTool<'select-rect'>('rect'),
    new ShapeSelectTool<'select-ellipse'>('ellipse'),
    new LassoSelectTool(),
    new PolygonSelectTool(),
    new WandSelectTool(),
    new TransformTool(),
    new TextTool(),
    new PanTool(),
    new ZoomTool(),
    new RotateTool(),
  ] as const;

export type Tools = ReturnType<typeof createTools>;
export type ToolName = Tools[number]['id'];
