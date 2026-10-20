/** Reads a 2D region of a texture back to the CPU. Rows are returned tightly packed. */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  bytesPerPixel: number,
  width: number,
  height: number,
  origin: { x: number; y: number; z?: number } = { x: 0, y: 0 },
): Promise<Uint8Array> {
  const unpadded = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpadded / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, origin: { x: origin.x, y: origin.y, z: origin.z ?? 0 } },
    { buffer, bytesPerRow },
    { width, height },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const out = new Uint8Array(unpadded * height);
  for (let y = 0; y < height; y++) out.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + unpadded), y * unpadded);
  buffer.unmap();
  buffer.destroy();
  return out;
}

/** Converts premultiplied half-float RGBA to straight 8-bit RGBA. */
export function halfPremultipliedToRgba8(bytes: Uint8Array): Uint8ClampedArray {
  const half = new Float16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out = new Uint8ClampedArray(half.length);
  for (let i = 0; i < half.length; i += 4) {
    const a = half[i + 3]!;
    if (a <= 0) continue;
    out[i] = (half[i]! / a) * 255 + 0.5;
    out[i + 1] = (half[i + 1]! / a) * 255 + 0.5;
    out[i + 2] = (half[i + 2]! / a) * 255 + 0.5;
    out[i + 3] = a * 255 + 0.5;
  }
  return out;
}
