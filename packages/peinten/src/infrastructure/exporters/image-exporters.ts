import type { Exporter, RasterImage } from '../../application/export.ts';

/** Encodes through OffscreenCanvas, available on the main thread and in workers. */
function encode(image: RasterImage, options: ImageEncodeOptions): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.putImageData(new ImageData(image.data as ImageDataArray, image.width, image.height), 0, 0);
  return canvas.convertToBlob(options);
}

/** PNG of the rendered document, with transparency. */
export function pngExporter(): Exporter {
  return async (source) => encode(await source.composite(), { type: 'image/png' });
}

export interface JpegExporterOptions {
  /** 0..1, 0.92 by default. */
  readonly quality?: number;
  /** Straight RGB in 0..1 that transparent areas are composited over, white by default. */
  readonly background?: readonly [number, number, number];
}

/** JPEG of the rendered document. JPEG has no alpha, so the image is flattened onto `background`. */
export function jpegExporter({ quality = 0.92, background = [1, 1, 1] }: JpegExporterOptions = {}): Exporter {
  return async (source) => {
    const image = await source.composite();
    const data = new Uint8ClampedArray(image.data.length);
    for (let i = 0; i < data.length; i += 4) {
      const a = image.data[i + 3]! / 255;
      for (let c = 0; c < 3; c++) data[i + c] = image.data[i + c]! * a + background[c]! * 255 * (1 - a);
      data[i + 3] = 255;
    }
    return encode({ ...image, data }, { type: 'image/jpeg', quality });
  };
}
