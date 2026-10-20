import { describe, expect, it } from 'vitest';
import { controlGridMesh, homographyMesh, squareToQuad } from './homography.ts';

describe('homography', () => {
  it('maps unit square corners onto the quad', () => {
    const quad = [10, 20, 110, 5, 130, 140, 0, 100];
    const h = squareToQuad(quad);
    const project = (u: number, v: number) => {
      const w = h[6] * u + h[7] * v + h[8];
      return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
    };
    const corners = [project(0, 0), project(1, 0), project(1, 1), project(0, 1)].flat();
    for (const [i, value] of corners.entries()) expect(value).toBeCloseTo(quad[i]!, 9);
    expect(homographyMesh(h, 2, 2)).toHaveLength(27);
  });

  it('reproduces an untouched control grid as a regular mesh', () => {
    const control = [0, 0, 50, 0, 100, 0, 0, 50, 50, 50, 100, 50, 0, 100, 50, 100, 100, 100];
    const mesh = controlGridMesh(control, 2, 4);
    // Vertex (3, 5) of an 8x8 subdivision of a 100px square lies at (37.5, 62.5).
    const o = (5 * 9 + 3) * 3;
    expect(mesh[o]).toBeCloseTo(37.5, 9);
    expect(mesh[o + 1]).toBeCloseTo(62.5, 9);
    expect(mesh[o + 2]).toBe(1);
  });
});
