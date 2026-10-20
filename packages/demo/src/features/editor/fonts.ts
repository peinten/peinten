/** Font families offered by the demo. Generic families resolve on every platform, including inside the worker. */
export const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'cursive', label: 'Cursive' },
] as const;

export const WRITING_MODES = [
  { value: 'horizontal-tb', label: 'Horizontal' },
  { value: 'vertical-rl', label: 'Vertical' },
] as const;
