/**
 * Layer blend modes in WGSL. Mode ids follow `BLEND_MODES` in domain/document/blend-mode.ts.
 * Formulas follow W3C Compositing Level 1 where it defines them, and Krita/Photoshop otherwise.
 * `blendOver` takes premultiplied colors and returns premultiplied colors.
 */
export const BLEND_WGSL = /* wgsl */ `
fn bm_lum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }

fn bm_clip(c: vec3f) -> vec3f {
  let l = bm_lum(c);
  let n = min(min(c.r, c.g), c.b);
  let x = max(max(c.r, c.g), c.b);
  var o = c;
  if (n < 0.0) { o = l + (o - l) * l / (l - n); }
  if (x > 1.0) { o = l + (o - l) * (1.0 - l) / (x - l); }
  return o;
}

fn bm_set_lum(c: vec3f, l: f32) -> vec3f { return bm_clip(c + (l - bm_lum(c))); }

fn bm_sat(c: vec3f) -> f32 { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

fn bm_set_sat(c: vec3f, s: f32) -> vec3f {
  let mx = max(max(c.r, c.g), c.b);
  let mn = min(min(c.r, c.g), c.b);
  if (mx > mn) { return (c - mn) * s / (mx - mn); }
  return vec3f(0.0);
}

fn bm_dodge(b: f32, s: f32) -> f32 {
  if (b <= 0.0) { return 0.0; }
  if (s >= 1.0) { return 1.0; }
  return min(1.0, b / (1.0 - s));
}

fn bm_burn(b: f32, s: f32) -> f32 {
  if (b >= 1.0) { return 1.0; }
  if (s <= 0.0) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - b) / s);
}

fn bm_hard_light(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b * 2.0 * s; }
  let t = 2.0 * s - 1.0;
  return b + t - b * t;
}

fn bm_soft_light(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  var d = sqrt(b);
  if (b <= 0.25) { d = ((16.0 * b - 12.0) * b + 4.0) * b; }
  return b + (2.0 * s - 1.0) * (d - b);
}

fn bm_channel(b: f32, s: f32, mode: u32) -> f32 {
  switch mode {
    case 1u: { return b * s; }
    case 2u: { return min(b, s); }
    case 3u: { return bm_burn(b, s); }
    case 4u: { return max(0.0, b + s - 1.0); }
    case 6u: { return b + s - b * s; }
    case 7u: { return max(b, s); }
    case 8u: { return bm_dodge(b, s); }
    case 9u: { return min(1.0, b + s); }
    case 11u: { return bm_hard_light(s, b); }
    case 12u: { return bm_soft_light(b, s); }
    case 13u: { return bm_hard_light(b, s); }
    case 14u: {
      if (s <= 0.5) { return bm_burn(b, 2.0 * s); }
      return bm_dodge(b, 2.0 * s - 1.0);
    }
    case 15u: { return clamp(b + 2.0 * s - 1.0, 0.0, 1.0); }
    case 16u: {
      if (s <= 0.5) { return min(b, 2.0 * s); }
      return max(b, 2.0 * s - 1.0);
    }
    case 17u: { return select(0.0, 1.0, b + s >= 1.0); }
    case 18u: { return abs(b - s); }
    case 19u: { return b + s - 2.0 * b * s; }
    case 20u: { return max(0.0, b - s); }
    case 21u: {
      if (s <= 0.0) { return select(0.0, 1.0, b > 0.0); }
      return min(1.0, b / s);
    }
    default: { return s; }
  }
}

fn bm_color(cb: vec3f, cs: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 5u: { return select(cb, cs, bm_lum(cs) < bm_lum(cb)); }
    case 10u: { return select(cb, cs, bm_lum(cs) > bm_lum(cb)); }
    case 22u: { return bm_set_lum(bm_set_sat(cs, bm_sat(cb)), bm_lum(cb)); }
    case 23u: { return bm_set_lum(bm_set_sat(cb, bm_sat(cs)), bm_lum(cb)); }
    case 24u: { return bm_set_lum(cs, bm_lum(cb)); }
    case 25u: { return bm_set_lum(cb, bm_lum(cs)); }
    default: {
      return vec3f(bm_channel(cb.r, cs.r, mode), bm_channel(cb.g, cs.g, mode), bm_channel(cb.b, cs.b, mode));
    }
  }
}

fn blendOver(backdrop: vec4f, source: vec4f, mode: u32, opacity: f32) -> vec4f {
  let as_ = source.a * opacity;
  if (as_ <= 0.0) { return backdrop; }
  if (mode == 0u) { return source * opacity + backdrop * (1.0 - as_); }
  let ab = backdrop.a;
  let cs = source.rgb / source.a;
  var cb = vec3f(0.0);
  if (ab > 0.0) { cb = backdrop.rgb / ab; }
  let mixed = clamp(bm_color(cb, cs, mode), vec3f(0.0), vec3f(1.0));
  let co = as_ * (1.0 - ab) * cs + ab * (1.0 - as_) * cb + as_ * ab * mixed;
  return vec4f(co, as_ + ab * (1.0 - as_));
}
`;
