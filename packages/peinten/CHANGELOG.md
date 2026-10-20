# Changelog

Notable changes to peinten, newest first. Versions follow semantic versioning. Breaking changes are listed under
"Breaking".

## 1.2.0 - Unreleased

### Added

- `ops.resizeCanvas({ width, height, offsetX, offsetY })` changes the canvas size as an undoable operation that
  collaborators share. Layers, text and selections move by the offset; the GPU caches follow the new size.
- `translateTiles` in `peinten/tiles`.
- `putPixels` takes `replace` to clear the rest of the layer.
- `NodeSnapshot.pixelsVersion` changes only when a layer's pixels do, unlike the snapshot itself, which also changes
  with thumbnails.

### Changed

- Joining a room no longer requires the same document size: the joining document takes the room's size.
- Views center the canvas again when the document size changes, keeping their zoom and rotation.
- `setTool` activates the new tool right away on the view that last received input, so tools such as `transform`
  draw their handles before the pointer moves.
- The rectangle selection tool snaps to whole pixels; `antialias` now only affects ellipses.
- `new ShapeSelectTool('rect')` infers the tool id; the type argument is no longer needed.
- `createRuntime` rejects when a custom filter kernel fails to compile, and later GPU errors reach `onError`.
- `put-tiles` is now version 2, so collaborators must run 1.2.0 or later together.

### Fixed

- `DocumentSnapshot.selection.bounds` encloses the selected pixels exactly instead of whole 64 px tiles.
- A filter that fails on the GPU no longer commits transparent pixels: the batch is skipped and `onError` gets the
  reason. Pixels outside the selection stay unchanged even when a kernel ignores the mask.
- `putPixels` no longer clears the parts of the touched tiles that lie outside its rectangle.
- Document snapshots now change when only the canvas height changes.

## 1.1.0 - 2026-10-20

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
