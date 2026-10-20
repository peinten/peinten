// Worker hosting: `exposeRuntime` runs inside the worker, `connectRuntime` on the main thread.
import type { AnyTool } from './application/tool.ts';
import { composeRuntime, type RuntimeOptions } from './compose.ts';
import { serveRuntime } from './infrastructure/worker/host.ts';

/** Call inside a worker script. Tools and other options must be created in the worker. */
export function exposeRuntime(options: Omit<RuntimeOptions<readonly AnyTool[]>, 'clientId'>): void {
  serveRuntime((clientId) => composeRuntime({ ...options, clientId }));
}

export { connectRuntime } from './infrastructure/worker/client.ts';
