# peinten

A raster painting engine in pure TypeScript.
Pixels live in 64 px tiles on the CPU, brushes are a port of libmypaint, and WebGPU composites and displays the result.
The engine is UI-framework agnostic and runs either on the main thread or in a Web Worker behind the same interface.

- Layers, folders (with pass-through), adjustment and text layers, 26 blend modes
- libmypaint brushes: `.myb` files, pressure, tilt, barrel rotation, smudge, spectral pigment mixing
- Selections, quick mask and affine, perspective and mesh transforms
- WGSL filters, destructive or as adjustment layers
- Undo/redo as an operation log with rollback and replay
- Collaboration through a sequencer, with transports for tabs, tests and your own server
- `.peinten` (CBOR) documents; PNG, JPEG and PSD export

## Install

```sh
npm install peinten
```

| Import | Contents |
|---|---|
| `peinten` | `createRuntime`, the `ops` factories, brushes, text helpers and the core types |
| `peinten/worker` | `exposeRuntime` (worker script) and `connectRuntime` (main thread) |
| `peinten/tools` | The built-in tools |
| `peinten/collab` | Sequencer, transports and the collaboration types; no DOM or GPU dependencies, so it also runs in Node |
| `peinten/exporting` | PNG, JPEG and PSD exporters for `doc.export`; only the ones you import are bundled |

WebGPU is required in the browser. The package is ESM only. TypeScript projects may need `@webgpu/types` for the
WebGPU names the public types reference.

## Quick start

```ts
// tools.ts
import { BrushTool, PanTool, ZoomTool } from 'peinten/tools';

export const createTools = () => [new BrushTool(), new PanTool(), new ZoomTool()] as const;
export type Tools = ReturnType<typeof createTools>;
```

```ts
// engine.worker.ts
import { exposeRuntime } from 'peinten/worker';
import { createTools } from './tools';

exposeRuntime({ tools: createTools() });
```

```ts
// main.ts
import { ops } from 'peinten';
import { connectRuntime } from 'peinten/worker';
import type { Tools } from './tools';

const runtime = await connectRuntime<Tools>(
  new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }),
);
const doc = await runtime.createDocument({ width: 1600, height: 1200 });
await runtime.createView({ canvas: document.querySelector('canvas')!, document: doc });
const layer = ops.addLayer({ name: 'Ink' });
await doc.dispatch(layer);
await doc.setActiveNode(layer.nodeId);
```

The view captures pointer input and the brush tool paints on the active layer. State for your UI comes from
synchronous snapshots: `doc.subscribe` and `doc.getSnapshot()`.

## Documentation

The [documentation](https://peinten.vercel.app/docs) covers UI integration, editing and undo, tools, brushes,
selections, filters, text, files, collaboration (including a WebSocket server), custom tools and filters, and the
architecture. The [demo](https://peinten.vercel.app/demo) is an editor built on peinten.

## Development

In [the repository](https://github.com/peinten/peinten), a pnpm workspace:

```sh
pnpm --filter peinten typecheck
pnpm --filter peinten test        # unit and GPU tests
pnpm --filter peinten test:gpu    # GPU tests only, via the `webgpu` package (Dawn)
pnpm --filter peinten build
```

## License

MIT. The brush engine is ported from libmypaint (ISC) and the bundled presets come from mypaint-brushes (CC0); see
`NOTICE`.
