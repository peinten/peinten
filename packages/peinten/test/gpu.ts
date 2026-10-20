import { afterAll } from 'vitest';
import { create } from 'webgpu';

/**
 * Creates a GPU device for the current test file and destroys it afterwards.
 * The `create()` result is kept local: storing it on globalThis keeps Dawn alive and stops the worker from exiting.
 */
export async function useDevice(): Promise<GPUDevice> {
  const gpu = create([]) as GPU;
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter available');
  const device = await adapter.requestDevice();
  afterAll(() => {
    device.destroy();
    // The GPU object owns the Dawn instance. If it is garbage collected while the device is alive,
    // Dawn's pending event processing touches the freed instance and crashes the process.
    return gpu.wgslLanguageFeatures;
  });
  return device;
}
