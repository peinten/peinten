import { describe, expect, it } from 'vitest';
import { normalizePointer, tiltFromAngles } from './normalize.ts';

const base = {
  pointerId: 1,
  offsetX: 10,
  offsetY: 20,
  pressure: 0.7,
  tiltX: 0,
  tiltY: 0,
  twist: 90,
  timeStamp: 5,
  button: 0,
  buttons: 1,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
};

describe('pointer normalization', () => {
  it('derives tiltX/tiltY from altitude and azimuth', () => {
    const [x, y] = tiltFromAngles(Math.PI / 4, 0);
    expect(x).toBeCloseTo(45);
    expect(y).toBeCloseTo(0);
    const [x2, y2] = tiltFromAngles(Math.PI / 4, Math.PI / 2);
    expect(x2).toBeCloseTo(0);
    expect(y2).toBeCloseTo(45);
  });

  it('fills pen tilt from angles only when tiltX and tiltY are missing', () => {
    const pen = normalizePointer(
      { ...base, pointerType: 'pen', altitudeAngle: Math.PI / 4, azimuthAngle: 0 },
      'move',
      2,
    );
    expect(pen.tiltX).toBeCloseTo(45);
    expect(pen.twist).toBe(90);
    expect(pen.screenX).toBe(20);
    const reported = normalizePointer(
      { ...base, pointerType: 'pen', tiltX: -30, tiltY: 10, altitudeAngle: 1, azimuthAngle: 1 },
      'move',
      1,
    );
    expect([reported.tiltX, reported.tiltY]).toEqual([-30, 10]);
  });

  it('gives mice a fixed pressure while pressed and no tilt or twist', () => {
    const mouse = normalizePointer({ ...base, pointerType: 'mouse', tiltX: 20 }, 'down', 1);
    expect([mouse.pressure, mouse.tiltX, mouse.twist]).toEqual([0.5, 0, 0]);
    expect(normalizePointer({ ...base, pointerType: 'mouse', buttons: 0 }, 'move', 1).pressure).toBe(0);
  });
});
