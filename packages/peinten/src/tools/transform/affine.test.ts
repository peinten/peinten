import { describe, expect, it } from 'vitest';
import type { ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import { applyAffine } from '../../domain/geometry/affine.ts';
import { AffineMode } from './affine.ts';

const source = { x: 100, y: 100, width: 200, height: 100 };
// Identity viewport: document and screen coordinates coincide.
const ctx = {
  viewport: { toScreen: (x: number, y: number) => [x, y], size: { width: 1000, height: 1000, devicePixelRatio: 1 } },
} as unknown as ToolContext;
const pointer = (x: number, y: number, modifiers: Partial<ToolPointerEvent['modifiers']> = {}) =>
  ({
    x,
    y,
    screenX: x,
    screenY: y,
    modifiers: { shift: false, ctrl: false, alt: false, meta: false, ...modifiers },
  }) as ToolPointerEvent;

function dragFrom(mode: AffineMode, from: [number, number], to: [number, number], modifiers = {}) {
  mode.begin(pointer(...from), ctx);
  mode.drag(pointer(...to, modifiers));
  mode.end();
}

describe('AffineMode', () => {
  it('scales from the opposite corner when dragging a corner handle', () => {
    const mode = new AffineMode(source);
    dragFrom(mode, [300, 200], [500, 300]);
    expect(applyAffine(mode.matrix(), 100, 100)).toEqual([100, 100]);
    const [x, y] = applyAffine(mode.matrix(), 300, 200);
    expect(x).toBeCloseTo(500);
    expect(y).toBeCloseTo(300);
  });

  it('moves when dragging inside and rotates when dragging outside', () => {
    const mode = new AffineMode(source);
    dragFrom(mode, [200, 150], [230, 170]);
    expect(applyAffine(mode.matrix(), 100, 100)).toEqual([130, 120]);
    const rotating = new AffineMode(source);
    // Drag a quarter turn around the center (200, 150), with Shift snapping to 15 degree steps.
    dragFrom(rotating, [400, 150], [201, 350], { shift: true });
    const [cx, cy] = applyAffine(rotating.matrix(), 300, 150);
    expect(cx).toBeCloseTo(200);
    expect(cy).toBeCloseTo(250);
  });

  it('round-trips through corners and supports flipping', () => {
    const mode = new AffineMode(source);
    dragFrom(mode, [300, 200], [520, 260]);
    const copy = AffineMode.fromCorners(source, mode.corners());
    for (const [i, v] of mode.corners().entries()) expect(copy.corners()[i]).toBeCloseTo(v, 6);
    copy.flip('x');
    const [x] = applyAffine(copy.matrix(), 100, 150);
    expect(x).toBeCloseTo(applyAffine(mode.matrix(), 300, 150)[0], 6);
  });
});
