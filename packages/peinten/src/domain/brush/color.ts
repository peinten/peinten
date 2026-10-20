// Ports of libmypaint's helpers.c color and angle utilities (originally from GIMP).

export const clamp = (x: number, low: number, high: number): number => (x > high ? high : x < low ? low : x);

/** Modulo that is always non-negative for positive N. */
export function modArith(a: number, n: number): number {
  return a - n * Math.floor(a / n);
}

export function smallestAngularDifference(angleA: number, angleB: number): number {
  let a = angleB - angleA;
  a = modArith(a + 180, 360) - 180;
  a += a > 180 ? -360 : a < -180 ? 360 : 0;
  return a;
}

/** In-place conversion of `c[0..2]` from RGB to HSV, all channels in 0..1. */
export function rgbToHsv(c: Float64Array): void {
  const r = clamp(c[0]!, 0, 1);
  const g = clamp(c[1]!, 0, 1);
  const b = clamp(c[2]!, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = 0;
  if (delta > 0.0001) {
    s = delta / max;
    if (r === max) {
      h = (g - b) / delta;
      if (h < 0) h += 6;
    } else if (g === max) {
      h = 2 + (b - r) / delta;
    } else {
      h = 4 + (r - g) / delta;
    }
    h /= 6;
  }
  c[0] = h;
  c[1] = s;
  c[2] = max;
}

/** In-place conversion of `c[0..2]` from HSV to RGB. */
export function hsvToRgb(c: Float64Array): void {
  const h = c[0]! - Math.floor(c[0]!);
  const s = clamp(c[1]!, 0, 1);
  const v = clamp(c[2]!, 0, 1);
  if (s === 0) {
    c[0] = c[1] = c[2] = v;
    return;
  }
  const hue = (h === 1 ? 0 : h) * 6;
  const i = Math.trunc(hue);
  const f = hue - i;
  const w = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const rgb = [
    [v, t, w],
    [q, v, w],
    [w, v, t],
    [w, q, v],
    [t, w, v],
    [v, w, q],
  ][i]!;
  c[0] = rgb[0]!;
  c[1] = rgb[1]!;
  c[2] = rgb[2]!;
}

/** In-place conversion of `c[0..2]` from RGB to HSL. */
export function rgbToHsl(c: Float64Array): void {
  const r = clamp(c[0]!, 0, 1);
  const g = clamp(c[1]!, 0, 1);
  const b = clamp(c[2]!, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    s = l <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
    const delta = max - min || 1;
    if (r === max) h = (g - b) / delta;
    else if (g === max) h = 2 + (b - r) / delta;
    else h = 4 + (r - g) / delta;
    h /= 6;
    if (h < 0) h += 1;
  }
  c[0] = h;
  c[1] = s;
  c[2] = l;
}

function hslValue(n1: number, n2: number, hue: number): number {
  let h = hue;
  if (h > 6) h -= 6;
  else if (h < 0) h += 6;
  if (h < 1) return n1 + (n2 - n1) * h;
  if (h < 3) return n2;
  if (h < 4) return n1 + (n2 - n1) * (4 - h);
  return n1;
}

/** In-place conversion of `c[0..2]` from HSL to RGB. */
export function hslToRgb(c: Float64Array): void {
  const h = c[0]! - Math.floor(c[0]!);
  const s = clamp(c[1]!, 0, 1);
  const l = clamp(c[2]!, 0, 1);
  if (s === 0) {
    c[0] = c[1] = c[2] = l;
    return;
  }
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  c[0] = hslValue(m1, m2, h * 6 + 2);
  c[1] = hslValue(m1, m2, h * 6);
  c[2] = hslValue(m1, m2, h * 6 - 2);
}
