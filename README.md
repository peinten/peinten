<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/demo/public/brand/peinten-logo-dark.svg">
    <img alt="peinten" src="packages/demo/public/brand/peinten-logo-light.svg" width="360">
  </picture>
</p>

A raster painting engine for the web, written in pure TypeScript: CPU tiles, a libmypaint brush port, WebGPU
compositing, and an operation log that drives undo, the worker build and collaboration. It is UI-framework agnostic.

The site at [peinten.vercel.app](https://peinten.vercel.app) has the [documentation](https://peinten.vercel.app/docs)
and a [demo editor](https://peinten.vercel.app/demo).

## Repository layout

| Path | Contents |
|---|---|
| [`packages/peinten`](packages/peinten) | The library, published to npm as `peinten`. Its [README](packages/peinten/README.md) covers installation and a quick start. |
| [`packages/demo`](packages/demo) | A Next.js site: the landing page at `/`, the documentation at `/docs` and the editor at `/demo`. |
| [`scripts`](scripts) | Repository tooling, such as the unused-code check. |
| [`patches`](patches) | pnpm patches applied to dependencies. |

The documentation is written as MDX pages of the demo site, under
[`packages/demo/src/app/(site)/docs`](<packages/demo/src/app/(site)/docs>).

## Development

Developed with Node.js 24 and pnpm 10. The demo needs a browser with WebGPU.

```sh
pnpm install
pnpm dev          # demo site with the editor
pnpm test         # unit tests and GPU tests (the GPU tests use the `webgpu` package, so no browser is needed)
pnpm typecheck
pnpm lint         # Biome, including the layer rules of the library
pnpm check:unused # unused declarations and exports; `-- --apply` fixes them
pnpm build        # library to packages/peinten/dist, site as a static export
```

`typescript` resolves to typescript-native-bridge, a TypeScript 7 (tsgo) build with the classic API, so `tsc` reports
version 7.0.2.

## Releasing

Pushing a tag such as `v0.2.0` runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml). The workflow
checks that the tag matches the package version and that the changelog has a dated heading for it. It then runs the
type check, lint, the unused-code check and the unit tests, and publishes `packages/peinten` to npm with provenance.
A version with a prerelease part, such as `0.2.0-beta.1`, is published under the `next` dist-tag instead of `latest`.

1. Set `version` in [`packages/peinten/package.json`](packages/peinten/package.json).
2. In [`packages/peinten/CHANGELOG.md`](packages/peinten/CHANGELOG.md), replace `Unreleased` in that version's
   heading with the date, e.g. `## 0.2.0 - 2026-11-01`.
3. Run `pnpm test`. The workflow skips the GPU tests because hosted runners have no WebGPU adapter.
4. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The workflow authenticates through npm trusted publishing, so the repository stores no npm token. The trusted
publisher on npm names this repository, the workflow file `publish.yml` and the `publish` environment. Set it up once
on npmjs.com under the package's Settings → Trusted Publisher, or with npm 11.15.0 or later:

```sh
npm trust github peinten --repo peinten/peinten --file publish.yml --env publish --allow-publish
```

npm accepts a trusted publisher only for a package that already exists. Renaming the workflow file or the environment
breaks publishing until the trusted publisher is updated. Protection rules on the `publish` environment, such as
required reviewers, apply to every release.

## License

MIT. The brush engine is ported from libmypaint (ISC) and the bundled presets come from mypaint-brushes (CC0); see
[`packages/peinten/NOTICE`](packages/peinten/NOTICE).
