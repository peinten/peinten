# Changelog

Notable changes to peinten, newest first. Versions follow semantic versioning. Breaking changes are listed under
"Breaking".

## 1.1.0 - Unreleased

### Added

- `version` on operation definitions. Raise it when an operation's meaning changes: peers running another version
  are refused when they join instead of diverging. Operations without a version keep the registry hash of 1.0.0.
- `peinten/tiles`: tile and pixel helpers for custom operations, such as `tileKey`, `rgba8ToTiles` and
  `floodSelect`.
- `OverlayBuilder.polygon` for filled and outlined areas.
- `PaintView.setOverlay(shapes)` to draw shapes over a view from the app, independent of the active tool.

## 1.0.0 - 2026-10-20

### Changed

- First stable release. The API is the same as in 0.1.0. From this version on, breaking changes come only with a new
  major version.

## 0.1.0 - 2026-10-20

### Added

- First release: the engine (`peinten`), the worker build (`peinten/worker`), the built-in tools (`peinten/tools`),
  collaboration (`peinten/collab`) and the PNG, JPEG and PSD exporters (`peinten/exporting`). The README lists the
  features.
