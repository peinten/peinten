import { LocalDocument } from '../src/application/document.ts';
import type { FrameScheduler } from '../src/application/ports/platform.ts';
import type { DocumentRenderCache, RenderSource } from '../src/application/ports/renderer.ts';
import type { TextEngine } from '../src/application/ports/text.ts';
import { createDocState } from '../src/domain/document/state.ts';
import { cborDocumentCodec } from '../src/infrastructure/encoders/cbor-document-codec.ts';
import { opContext, registry } from './helpers.ts';

/** Render cache that only records syncs; the application layer does not need real pixels on screen. */
export class FakeCache implements DocumentRenderCache {
  syncs = 0;
  /** What the last sync would have drawn. */
  source: RenderSource | null = null;
  sync(source: RenderSource): void {
    this.syncs++;
    this.source = source;
  }
  readComposite(): Promise<Uint8ClampedArray> {
    return Promise.resolve(new Uint8ClampedArray(4));
  }
  readGroup(): Promise<Uint8ClampedArray> {
    return Promise.resolve(new Uint8ClampedArray(4));
  }
  dispose(): void {}
}

/** Runs frame callbacks only when the test flushes, so frames are deterministic. */
export class ManualScheduler implements FrameScheduler {
  #callbacks: ((time: number) => void)[] = [];
  time = 0;
  request(callback: (time: number) => void): void {
    this.#callbacks.push(callback);
  }
  flush(): void {
    const callbacks = this.#callbacks;
    this.#callbacks = [];
    this.time += 1000;
    for (const callback of callbacks) callback(this.time);
  }
}

const textEngine: TextEngine = {
  id: 'fake',
  layout: async () => ({ glyphs: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }),
  rasterize: () => null,
};

export function newLocalDocument(
  options: {
    width?: number;
    height?: number;
    historyLimit?: number;
    clientId?: string;
    registryHash?: string;
    onError?: (error: unknown) => void;
  } = {},
) {
  const scheduler = new ManualScheduler();
  const document = new LocalDocument(createDocState(options.width ?? 128, options.height ?? 128, 'L'), {
    clientId: options.clientId ?? 'me',
    registry,
    opContext,
    mixer: opContext.mixer,
    cache: new FakeCache(),
    scheduler,
    thumbnails: { create: async () => ({ close() {} }) as ImageBitmap },
    textEngine,
    codec: cborDocumentCodec,
    registryHash: options.registryHash ?? 'test',
    historyLimit: options.historyLimit ?? 100,
    onError:
      options.onError ??
      ((error) => {
        throw error;
      }),
  });
  return { document, scheduler };
}
