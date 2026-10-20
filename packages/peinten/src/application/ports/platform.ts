/** Calls back before the next frame; requestAnimationFrame where available. */
export interface FrameScheduler {
  request(callback: (time: number) => void): void;
}

/** Turns small RGBA images into something the UI can draw directly. */
export interface ThumbnailFactory {
  create(rgba: Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap>;
}
