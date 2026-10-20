import type { PaintRuntime } from 'peinten';
import { connectRuntime } from 'peinten/worker';
import type { Tools } from './tools';

let runtime: Promise<PaintRuntime<Tools>> | null = null;

/** The one runtime of the page, hosted in a worker. Shared across React StrictMode re-mounts. */
export function getRuntime(): Promise<PaintRuntime<Tools>> {
  runtime ??= connectRuntime<Tools>(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }));
  return runtime;
}
