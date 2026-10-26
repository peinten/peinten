# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

pnpm workspace with two packages:

- `packages/peinten`: the library. A raster painting engine in pure TypeScript (no WASM): CPU tiles, a libmypaint
  brush port, WebGPU compositing, an operation log for undo and collaboration.
- `packages/demo`: Next.js 16 (Turbopack, `output: 'export'`) app with Tailwind 4 and Base UI. `/` is the MDX landing
  page, `/docs/*` are the MDX docs, `/demo` is the editor.

The docs MDX pages (`packages/demo/src/app/(site)/docs/**/page.mdx`) are the single source of truth for user-facing
documentation; `packages/peinten/README.md` only gives an overview and links to the docs site, https://peinten.vercel.app/docs. Update the docs, not the README,
when behavior changes. The page order lives in `packages/demo/src/features/docs/nav.ts`.

`packages/peinten/CHANGELOG.md` is where Dependabot reads release notes (it follows `repository.directory` in
`package.json`). Record user-visible changes there under a `## <version> - Unreleased` heading and replace
`Unreleased` with the date when publishing. Keep version headings as plain `## 0.2.0 - 2026-11-01`: Dependabot takes
the version from the text after `#` up to the first space, so `[0.2.0]` would not parse. The release steps and the
trusted publisher setup are in the root README ("Releasing"); `.github/workflows/publish.yml` publishes on `v*` tags.

## Commands

```sh
pnpm dev                                   # demo dev server (the .claude/launch.json "demo" entry uses port 3200)
pnpm typecheck                             # all packages; peinten also checks src/domain without DOM/WebGPU types
pnpm test                                  # all tests
pnpm lint                                  # biome check .
pnpm check:unused                          # scripts/check-unused.ts (ts-morph); `-- --apply` removes/unexports/privatizes
pnpm --filter peinten test:unit
pnpm --filter peinten test:gpu             # real WebGPU via the `webgpu` npm package (Dawn)
pnpm --filter peinten exec vitest run --project unit src/domain/ops/ops.test.ts -t "moves the selection"
pnpm --filter peinten build                # tsc -p tsconfig.build.json → dist (exports switch to dist on publish)
pnpm --filter demo build                   # static export; also type-checks the demo
```

- `typescript` is overridden by typescript-native-bridge (tsgo). `tsc` printing "Version 7.0.2" and `▎ TNB ACTIVE`
  on stderr are expected. ts-morph is patched (`patches/`) to use this `typescript`; `check-unused` must use the
  program's `findReferencesTsgo`, not ts-morph's language service (TNB keeps one snapshot and the language service
  breaks it).
- `check-unused` cannot parse MDX; it mirrors `.mdx` import lines into virtual files so components used only from MDX
  count as used. `warn` lines (exports only used in their file, members only used in their class) are advice;
  `error` lines (unused declarations) must be fixed, and the script exits with 1 while any remain.
- Running `next build` while the dev server is running rewrites `.next`; restart the dev server afterwards.

## peinten architecture

### Layers (enforced)

`src/` is split clean-architecture style; dependencies only point inward:

- `domain/`: pure model and rules (tiles, document state, operations, history, brush engine, raster, text, filters).
  Type-checked by `tsconfig.domain.json` without DOM/WebGPU libs. Uses only pure libraries (mutative, valibot,
  fflate); Biome blocks comlink, cbor-x, ag-psd and webgpu-utils there.
- `application/`: use cases and ports (`ports/`): `LocalRuntime`, `LocalDocument`, `LocalView`, the tool contract
  (`tool.ts`), collaboration session/sequencer, export, snapshots.
- `infrastructure/`: port implementations: WebGPU renderer, Canvas2D text, the CBOR file codec, exporters (PNG/JPEG, PSD), input
  capture, comlink worker bridge, collaboration transports.
- `tools/`: `ITool` implementations. May import only `application/tool.ts` and `domain`. The engine never imports
  tools; tools reach it only through `ToolContext`.
- `index.ts`, `worker.ts`, `tools.ts`, `collab.ts`, `exporting.ts`, `tiles.ts` (+ `compose.ts`) are composition
  roots and the public entry points (`peinten`, `peinten/worker`, `peinten/tools`, `peinten/collab`,
  `peinten/exporting`, `peinten/tiles`). Built-in tool classes are exported only from `peinten/tools`; the tool
  contract types stay in `peinten`. `collab.ts` and `tiles.ts` must stay free of DOM/GPU dependencies
  (`tsconfig.domain.json` type-checks `tiles.ts` with the domain).
- Exporters are plain functions passed to `doc.export(exporter)`; the runtime never imports them, so ag-psd is
  bundled only by apps that import `psdExporter`. Keep `compose.ts` free of exporters. In the worker build an
  exporter runs on the main thread and reads the document through an export session (`beginExport`/`endExport`)
  that holds the worker document's apply queue.

Biome `noRestrictedImports` overrides in `biome.json` enforce the layer rules for `domain`, `application`, `tools` and
`infrastructure` (entry points are exempt), so tests live in the layer whose imports they need (e.g. tests using the in-memory hub sit in `infrastructure/collab/`).

### State, operations, history

- Pixels: premultiplied RGBA fix15 (`FIX15_ONE` = `1 << 15` = 1.0) in 64×64 `Uint16Array` tiles; selections are single-channel
  tiles of the same size. Committed tiles are immutable (copy-on-write), so diffs and GPU uploads are reference comparisons
  and rolling back history only swaps state references.
- `DocState` changes only by applying operations registered with `defineOperation({ type, schema, prepare?, apply })`.
  `apply` must be deterministic because every collaborator recomputes it. `prepare` runs once on the issuer to embed
  environment-dependent results (text rasterization). `OperationConflictError` skips a batch on every peer alike.
- Adding a core operation: define it in `domain/ops/*-ops.ts`, register it in `domain/ops/core.ts`, add a factory to
  `ops` in `domain/ops/factories.ts`. Operation types are part of the registry hash, so collaborators must match.
- Changing what a released operation does (its `schema` or `apply`) requires raising its `version`; versions above 1
  enter the registry hash (`type@version`), so mismatched peers are refused instead of diverging. Version 1 is left
  out of the hash to keep it equal to 1.0.0's.
- `Timeline` (`domain/history/timeline.ts`) keeps batches with before/after states: confirmed prefix + pending local
  batches; anything landing in the middle rolls back and replays. Undo/redo are `set-op-enabled` batches; each client
  undoes only its own batches.
- `ApplyQueue` serializes everything that touches the timeline (dispatch, undo, peer commits, export). A live stroke
  occupies the queue until it ends, which is how peer commits are deferred during a stroke. `StrokeSession` holds
  working tiles that shadow committed tiles on screen until the stroke commits.
- Persistent changes go through `dispatch` (an array is one atomic, single-undo batch); per-client state
  (active node, quick mask, mask editing, previews, tool, resources) has dedicated methods and never enters history.
- Layer masks (`node.mask`, `domain/document/layer-mask.ts`, `domain/ops/mask-ops.ts`) are single-channel tiles plus
  a `fill` for missing tiles, so anything that moves or reads mask tiles must use the fill (`translateTiles(..., fill)`,
  `MaskSurface` options, `decodeTiles`) rather than assume missing means 0. Strokes reach a mask through the
  `{ maskOf }` target.

### Rendering

CPU computes dabs; GPU composites. Per runtime (`GpuShared`): device and the compute pipelines for
compositing, filters, mips and warp previews. Per document: `DocumentGpuCache` (tile atlas as
`rgba16uint` texture array, selection texture, `rgba16float` composite with mips, adjustment intermediates, warp
preview). The size follows `DocState`: when `sync` sees a new size it replaces the canvas-sized textures (the tile
atlas stays) and bumps `textureGeneration`, which makes views rebuild their bind groups. Per view: canvas context,
display and overlay render pipelines, sampler, uniforms. The layer tree is flattened into a stack program
(`composite-plan.ts`) run by a compute shader per dirty tile; adjustment layers split it into stages with `FilterPass`
in between. Filters (WGSL) use integer math only so results are bit-identical across GPUs; destructive filters and
adjustment layers share one kernel. A GPU validation error invalidates the whole command buffer and leaves outputs
zeroed, so `GpuFilterExecutor` runs inside an error scope and throws `OperationConflictError` on failure, and it
restores pixels with zero selection coverage after readback. `WebGpuBackend.create` validates custom kernels and
forwards uncaptured GPU errors to `onError`. Masks live in a second, `r16uint` atlas (`TileSources`); an `OP.mask`
instruction before a blending instruction scales its opacity per pixel, which covers layers, folders (`pop`) and
adjustment layers (`filterOut`) alike.

### Runtime surface and snapshots

`PaintRuntime`/`PaintDocument`/`PaintView` (`application/api.ts`) are implemented by both `MainThreadRuntime` and the
comlink client (`infrastructure/worker/client.ts`); keep the two in sync when adding methods (also
`worker/protocol.ts` and `worker/host.ts`). `subscribe`/`getSnapshot` are synchronous and snapshots preserve identity
of unchanged parts (`SnapshotBuilder`, and `preserve()` on the worker mirror). The library must not depend on any UI
framework.

### Collaboration

`Sequencer` (`application/collab/sequencer.ts`) only orders commits, validates and dedupes by
`clientId`+`batchId`, and asks participants for snapshots (empty room: the first joiner's document becomes the base).
`CollabSession` applies commits through the document's queue, resends pending batches after every welcome, and
resyncs from a snapshot when a toggle targets a batch outside its history. Transports: in-memory hub (tests,
`settle(random)` shuffles delivery), BroadcastChannel + Web Locks leader election, worker relay over `MessageChannel`.
Collaborators must share the registry hash (operations, filters, color mixer); the document size travels with the
state (`resize-canvas`), so a joiner takes the room's size.
Strokes in progress on paint layers are relayed unsequenced as `stroke` messages (begin/samples/end, keyed by seed),
like presence; `PeerStrokes` replays them on each peer into extra `RenderSource.live` entries and drops a preview when
the commit with the same seed is applied. Presence and `stroke` messages bypass the apply queue so they keep flowing
during a local stroke.

## Testing notes

- `test/fakes.ts` `newLocalDocument()` builds a `LocalDocument` with a `ManualScheduler`: snapshots publish only after
  `scheduler.flush()`. Its default `onError` throws, so tests expecting skipped batches must pass their own `onError`.
  `await document.dispatch([])` waits for queued work.
- GPU tests run in Vitest's `threads` pool (Dawn crashes in forks) and must keep the `create()` GPU object alive until
  `afterAll` (see `test/gpu.ts`), otherwise Dawn segfaults.
- In the in-app browser pane, synthetic `PointerEvent`s report wrong `offsetX/offsetY`; verify drawing with real mouse
  input (e.g. a drag action) instead.

## Demo conventions

- `src/components/` holds only shared, generic components; feature-specific ones go under `src/features/<feature>/`
  (`editor`, `docs`, `landing`, `site`).
- The editor talks to a single worker-hosted runtime (`src/engine/runtime.ts`, `engine.worker.ts`, `tools.ts`).
- MDX is configured in `next.config.ts`; Turbopack requires remark/rehype plugins to be referenced by package name
  with serializable options.
- Diagrams in the docs use ``<MermaidDiagram chart={`...`} label="..." />`` (`features/docs/mermaid-diagram.tsx`,
  rendered on the client). A `;` inside a Mermaid message or note ends the statement and breaks the diagram.
