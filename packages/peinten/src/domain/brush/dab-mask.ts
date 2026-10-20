import { TILE_SIZE } from '../tiles/tile.ts';

/** Inclusive pixel bounds of a dab inside one tile. */
export interface MaskBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const rrBuffer = new Float64Array(TILE_SIZE * TILE_SIZE);
const RAD_AREA_1 = Math.sqrt(1 / Math.PI);

function rSample(x: number, y: number, aspect: number, sn: number, cs: number): number {
  const yyr = (y * cs - x * sn) * aspect;
  const xxr = y * sn + x * cs;
  return yyr * yyr + xxr * xxr;
}

/** Port of `calculate_rr_antialiased` for dabs smaller than 3 pixels. */
function rrAntialiased(
  xp: number,
  yp: number,
  x: number,
  y: number,
  aspect: number,
  sn: number,
  cs: number,
  oneOverRadius2: number,
  rAaStart: number,
): number {
  const pixelRight = x - xp;
  const pixelBottom = y - yp;
  const pixelCenterX = pixelRight - 0.5;
  const pixelCenterY = pixelBottom - 0.5;
  const pixelLeft = pixelRight - 1;
  const pixelTop = pixelBottom - 1;
  let nearestX = 0;
  let nearestY = 0;
  let rrNear = 0;
  if (!(pixelLeft < 0 && pixelRight > 0 && pixelTop < 0 && pixelBottom > 0)) {
    // closest_point_to_line(cs, sn, center)
    const l2 = cs * cs + sn * sn;
    const t = (pixelCenterX * cs + pixelCenterY * sn) / l2;
    nearestX = Math.min(Math.max(cs * t, pixelLeft), pixelRight);
    nearestY = Math.min(Math.max(sn * t, pixelTop), pixelBottom);
    rrNear = rSample(nearestX, nearestY, aspect, sn, cs) * oneOverRadius2;
  }
  if (rrNear > 1) return rrNear;
  // sign_point_in_line(center, cs, -sn)
  const centerSign = (pixelCenterX - cs) * sn - cs * (pixelCenterY + sn);
  const farthestX = centerSign < 0 ? nearestX - sn * RAD_AREA_1 : nearestX + sn * RAD_AREA_1;
  const farthestY = centerSign < 0 ? nearestY + cs * RAD_AREA_1 : nearestY - cs * RAD_AREA_1;
  const rFar = rSample(farthestX, farthestY, aspect, sn, cs);
  const rrFar = rFar * oneOverRadius2;
  if (rFar < rAaStart) return (rrFar + rrNear) * 0.5;
  const visibilityNear = (1 - rrNear) / (1 + rrFar - rrNear);
  return 1 - visibilityNear;
}

/**
 * Port of libmypaint's `render_dab_mask`. Writes fix15 coverage into `mask` (row-major TILE_SIZE²) for the dab
 * centred at tile-local (x, y) and returns the touched bounds, or null when the dab misses the tile.
 * Pixels outside the returned bounds are left untouched; callers only read inside them.
 */
export function renderDabMask(
  mask: Uint16Array,
  x: number,
  y: number,
  radius: number,
  hardnessIn: number,
  softness: number,
  aspectIn: number,
  angle: number,
  bounds: MaskBounds,
): MaskBounds | null {
  const hardness = Math.min(Math.max(hardnessIn, 0), 1);
  const aspect = aspectIn < 1 ? 1 : aspectIn;
  const seg1Offset = 1 - softness;
  const seg1Slope = -(1 / hardness - 1) * (1 - softness);
  const seg2Offset = (hardness / (1 - hardness)) * (1 - softness);
  const seg2Slope = (-hardness / (1 - hardness)) * (1 - softness);

  const angleRad = (angle / 360) * 2 * Math.PI;
  const cs = Math.cos(angleRad);
  const sn = Math.sin(angleRad);

  const rFringe = radius + 1;
  const x0 = Math.max(Math.floor(x - rFringe), 0);
  const y0 = Math.max(Math.floor(y - rFringe), 0);
  const x1 = Math.min(Math.floor(x + rFringe), TILE_SIZE - 1);
  const y1 = Math.min(Math.floor(y + rFringe), TILE_SIZE - 1);
  if (x0 > x1 || y0 > y1) return null;
  const oneOverRadius2 = 1 / (radius * radius);

  if (radius < 3) {
    const aaBorder = 1;
    let rAaStart = radius > aaBorder ? radius - aaBorder : 0;
    rAaStart *= rAaStart / aspect;
    for (let yp = y0; yp <= y1; yp++) {
      for (let xp = x0; xp <= x1; xp++) {
        rrBuffer[yp * TILE_SIZE + xp] = rrAntialiased(xp, yp, x, y, aspect, sn, cs, oneOverRadius2, rAaStart);
      }
    }
  } else {
    for (let yp = y0; yp <= y1; yp++) {
      const yy = yp + 0.5 - y;
      for (let xp = x0; xp <= x1; xp++) {
        const xx = xp + 0.5 - x;
        const yyr = (yy * cs - xx * sn) * aspect;
        const xxr = yy * sn + xx * cs;
        rrBuffer[yp * TILE_SIZE + xp] = (yyr * yyr + xxr * xxr) * oneOverRadius2;
      }
    }
  }

  let any = false;
  for (let yp = y0; yp <= y1; yp++) {
    for (let xp = x0; xp <= x1; xp++) {
      const i = yp * TILE_SIZE + xp;
      const rr = rrBuffer[i]!;
      let opa = 0;
      if (rr <= 1) opa = rr <= hardness ? seg1Offset + rr * seg1Slope : seg2Offset + rr * seg2Slope;
      const value = Math.trunc(opa * 32768);
      mask[i] = value;
      if (value) any = true;
    }
  }
  if (!any) return null;
  bounds.x0 = x0;
  bounds.y0 = y0;
  bounds.x1 = x1;
  bounds.y1 = y1;
  return bounds;
}
