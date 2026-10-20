import { describe, expect, it } from 'vitest';
import { newLocalDocument } from '../../test/fakes.ts';
import { OVERLAY_VERTEX_FLOATS, OverlayBuilder, type OverlayGeometry } from './overlay.ts';
import type { ViewSurface } from './ports/renderer.ts';
import { LocalView } from './view.ts';

const RED = [1, 0, 0, 0.5] as const;
const BLUE = [0, 0, 1, 1] as const;

/** Colors of the drawn vertices, one entry per triangle. */
function triangleColors(geometry: OverlayGeometry): string[] {
  const colors: string[] = [];
  const stride = OVERLAY_VERTEX_FLOATS * 3;
  for (let i = 0; i < geometry.vertices.length; i += stride)
    colors.push(geometry.vertices.slice(i + 2, i + 6).join(','));
  return colors;
}

describe('overlays', () => {
  it('fills and outlines polygons', () => {
    const builder = new OverlayBuilder([2, 0, 0, 2, 10, 10], 1);
    builder.polygon([0, 0, 10, 0, 10, 10, 0, 10], { fill: RED, stroke: { color: BLUE, outline: false } });
    const geometry = builder.build();
    const colors = triangleColors(geometry);
    // A quad fills with two triangles, under the outline drawn after it.
    expect(colors.slice(0, 2)).toEqual([RED.join(','), RED.join(',')]);
    expect(colors.slice(2).every((color) => color === BLUE.join(','))).toBe(true);
    // Document coordinates go through the view transform.
    expect([...geometry.vertices.slice(0, 2)].every((value) => value >= 10 && value <= 30)).toBe(true);
  });

  it('draws app shapes on views without tools until they are replaced', () => {
    const { document, scheduler } = newLocalDocument();
    const drawn: OverlayGeometry[] = [];
    const surface: ViewSurface = { resize() {}, render: (_viewport, overlay) => drawn.push(overlay), dispose() {} };
    const view = new LocalView(document, surface, { host: null, navigation: false, background: 'checker' });
    view.resize({ width: 100, height: 100, devicePixelRatio: 1 });
    view.setOverlay([{ kind: 'polygon', points: [0, 0, 20, 0, 20, 20], fill: RED }]);
    scheduler.flush();
    expect(triangleColors(drawn.at(-1)!)).toEqual([RED.join(',')]);
    view.setOverlay([]);
    scheduler.flush();
    expect(drawn.at(-1)!.vertices.length).toBe(0);
  });
});
