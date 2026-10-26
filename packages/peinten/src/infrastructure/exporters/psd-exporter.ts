import { type Layer, type LayerMaskData, type LayerTextData, type TextStyle, writePsdUint8Array } from 'ag-psd';
import type { Exporter, ExportLayer, ExportMask, PlacedImage } from '../../application/export.ts';
import { applyAffine } from '../../domain/geometry/affine.ts';
import type { TextStyle as PeintenTextStyle, TextLayerData } from '../../domain/text/text-layer.ts';

const JUSTIFICATION = { start: 'left', center: 'center', end: 'right' } as const;

function pixels(image: PlacedImage | null): Pick<Layer, 'top' | 'left' | 'imageData'> {
  if (!image) return {};
  return { top: image.y, left: image.x, imageData: { width: image.width, height: image.height, data: image.data } };
}

function textStyle(style: PeintenTextStyle, lineHeight: number): TextStyle {
  return {
    // PSD expects PostScript names; CSS families may not resolve in Photoshop, where the rendered image remains.
    font: { name: style.fontFamily },
    fontSize: style.fontSize,
    fauxBold: style.fontWeight >= 700,
    fauxItalic: style.fontStyle === 'italic',
    tracking: (style.letterSpacing / style.fontSize) * 1000,
    autoLeading: false,
    leading: style.fontSize * lineHeight,
    fillColor: { r: style.color[0] * 255, g: style.color[1] * 255, b: style.color[2] * 255 },
  };
}

/** Maps a text layer to PSD text data. Positions approximate peinten's layout, which PSD readers redo anyway. */
function textData(text: TextLayerData): LayerTextData {
  const vertical = text.writingMode === 'vertical-rl';
  const lineSize = Math.max(...text.runs.map((run) => run.style.fontSize), 1) * text.paragraph.lineHeight;
  const frame = text.frame;
  // Point text is anchored at the first baseline; box text at the box origin.
  const [x, y] =
    frame.kind === 'area'
      ? applyAffine(text.transform, 0, 0)
      : applyAffine(text.transform, vertical ? -lineSize / 2 : 0, vertical ? 0 : lineSize * 0.8);
  const [a, b, c, d] = text.transform;
  return {
    // Photoshop separates paragraphs with carriage returns; the length stays the same, so style runs still line up.
    text: text.runs
      .map((run) => run.text)
      .join('')
      .replaceAll('\n', '\r'),
    transform: [a, b, c, d, x, y],
    antiAlias: 'smooth',
    orientation: vertical ? 'vertical' : 'horizontal',
    style: text.runs[0] && textStyle(text.runs[0].style, text.paragraph.lineHeight),
    styleRuns: text.runs.map((run) => ({
      length: run.text.length,
      style: textStyle(run.style, text.paragraph.lineHeight),
    })),
    paragraphStyle: { justification: JUSTIFICATION[text.paragraph.align] },
    ...(frame.kind === 'area'
      ? {
          shapeType: 'box',
          boxBounds: vertical ? [-frame.width, 0, 0, frame.height] : [0, 0, frame.width, frame.height],
        }
      : { shapeType: 'point' }),
  };
}

/** PSD masks are grayscale: the image covers the rectangle and `defaultColor` the rest. */
function layerMask(mask: ExportMask): LayerMaskData {
  const rgba = new Uint8ClampedArray(mask.data.length * 4);
  for (let i = 0; i < mask.data.length; i++) {
    rgba.fill(mask.data[i]!, i * 4, i * 4 + 3);
    rgba[i * 4 + 3] = 255;
  }
  return {
    top: mask.y,
    left: mask.x,
    bottom: mask.y + mask.height,
    right: mask.x + mask.width,
    defaultColor: mask.fill * 255,
    disabled: !mask.enabled,
    ...(mask.width > 0 && { imageData: { width: mask.width, height: mask.height, data: rgba } }),
  };
}

function toLayer(layer: ExportLayer): Layer {
  const base: Layer = {
    name: layer.name,
    hidden: !layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode.replaceAll('-', ' ') as Layer['blendMode'],
    ...(layer.mask && { mask: layerMask(layer.mask) }),
  };
  switch (layer.kind) {
    case 'pixels':
      return { ...base, ...pixels(layer.image) };
    case 'text':
      return { ...base, ...pixels(layer.image), text: textData(layer.text) };
    case 'group':
      return {
        ...base,
        ...(layer.passThrough && { blendMode: 'pass through' }),
        opened: true,
        children: layer.children.map(toLayer),
      };
  }
}

/** PSD with the layer tree, through ag-psd. Pixel data is passed as arrays, so no canvas is needed. */
export function psdExporter(): Exporter {
  return async (source) => {
    const bytes = writePsdUint8Array(
      {
        width: source.width,
        height: source.height,
        imageData: await source.composite(),
        children: (await source.layers()).map(toLayer),
      },
      { generateThumbnail: false, noBackground: true },
    );
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/vnd.adobe.photoshop' });
  };
}
