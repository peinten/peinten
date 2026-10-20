/** Layer blend modes. The order is part of the GPU contract: the index is the blend mode id in WGSL. */
export const BLEND_MODES = [
  'normal',
  'multiply',
  'darken',
  'color-burn',
  'linear-burn',
  'darker-color',
  'screen',
  'lighten',
  'color-dodge',
  'linear-dodge',
  'lighter-color',
  'overlay',
  'soft-light',
  'hard-light',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

export function blendModeIndex(mode: BlendMode): number {
  return BLEND_MODES.indexOf(mode);
}
