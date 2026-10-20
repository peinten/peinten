import { globals } from 'webgpu';

// Dawn's Node binding exposes WebGPU enums such as GPUBufferUsage only through `globals`.
Object.assign(globalThis, globals);
