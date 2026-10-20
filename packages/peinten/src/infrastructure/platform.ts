import type { FrameScheduler, ThumbnailFactory } from '../application/ports/platform.ts';

/** requestAnimationFrame where available (windows and most workers), a 16 ms timer otherwise. */
export const animationFrameScheduler: FrameScheduler = {
  request(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(callback);
    else setTimeout(() => callback(performance.now()), 16);
  },
};

export const imageBitmapThumbnails: ThumbnailFactory = {
  create(rgba, width, height) {
    return createImageBitmap(new ImageData(rgba as ImageDataArray, width, height));
  },
};
