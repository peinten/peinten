import { describe, expect, it } from 'vitest';
import { createDocState } from '../document/state.ts';
import { StrokeRenderer } from '../ops/stroke-renderer.ts';
import { TILE_SIZE } from '../tiles/tile.ts';
import { libMyPaintPigmentMixer, mixColors } from './color-mixer.ts';
import { renderDabMask } from './dab-mask.ts';
import { CompiledBrush } from './mapping.ts';
import { parseMyb, serializeMyb } from './myb.ts';
import { resolveBrush } from './resolve-brush.ts';
import { RngDouble } from './rng.ts';
import { DEFAULT_BRUSH, I, INPUT_COUNT, S, SETTING_COUNT } from './settings.ts';
import { previewStrokeSamples, SampleRecorder } from './stroke-samples.ts';

/** Reference values produced by compiling libmypaint's rng-double.c. */
const RNG_1000 = [
  0.93706034632868929, 0.96544227514193759, 0.87643444469096199, 0.090471831360547705, 0.059598339810316148,
  0.36616172616426779, 0.033872513220953637, 0.15969046827662003, 0.83219967389829663, 0.26391141904530069,
  0.50650758990053046, 0.15187652227073833, 0.24432942303918992, 0.44095757091779419, 0.42212827684775567,
  0.40651145405279321, 0.055601688913114788, 0.80429152216678479, 0.33909916823659536, 0.10156971188974029,
  0.75241058898172342, 0.44402442064923364, 0.80042459813303446, 0.3964514993813717, 0.65373066063376406,
];
const RNG_42 = [0.149428291655054, 0.16381004088660767, 0.16369974415815158, 0.18416107237959478, 0.21283283894555516];

/** [x, y, radius, hardness, softness, aspect, angle, sum, position-weighted sum] from libmypaint's render_dab_mask. */
const MASK_REFERENCE = [
  [32, 32, 10, 0.8, 0, 1, 0, 8229868, 16858884598],
  [20.3, 40.7, 2.2, 0.5, 0.1, 1, 0, 265187, 687585360],
  [10.5, 10.5, 1.1, 0.9, 0, 1, 0, 152857, 99509907],
  [32, 32, 20, 0.3, 0.2, 3, 45, 3294006, 6747771291],
  [5, 60, 30, 1, 0, 1, 0, 32669696, 101910806528],
  [31.2, 33.9, 0.7, 0.6, 0, 2, 30, 23323, 50618267],
] as const;

const black = { color: [0, 0, 0] as const, eraser: false, size: 20, opacity: null };

function hashTiles(tiles: ReadonlyMap<number, Uint16Array>): string {
  let h = 0x811c9dc5;
  for (const key of [...tiles.keys()].sort((a, b) => a - b)) {
    h = Math.imul(h ^ key, 0x01000193) >>> 0;
    for (const value of tiles.get(key)!) h = Math.imul(h ^ value, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function render(samples: Float32Array, chunk = samples.length) {
  const state = createDocState(256, 128, 'L');
  const renderer = new StrokeRenderer(
    state,
    { target: { nodeId: 'L' }, brush: resolveBrush({ ...black, brush: DEFAULT_BRUSH }), seed: 7, clientId: 'me' },
    libMyPaintPigmentMixer,
  );
  for (let o = 0; o < samples.length; o += chunk) renderer.feed(samples.subarray(o, o + chunk));
  const next = renderer.commit();
  const layer = next.nodes.get('L');
  if (layer?.kind !== 'paint') throw new Error('unreachable');
  return layer.tiles;
}

describe('libmypaint port', () => {
  it('reproduces rng-double.c exactly', () => {
    const rng = new RngDouble(1000);
    expect(RNG_1000.map(() => rng.next())).toEqual(RNG_1000);
    rng.setSeed(42);
    expect(RNG_42.map(() => rng.next())).toEqual(RNG_42);
  });

  it('matches render_dab_mask within float32 rounding', () => {
    const mask = new Uint16Array(TILE_SIZE * TILE_SIZE);
    const bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
    for (const [x, y, r, h, s, ar, ang, sum, weighted] of MASK_REFERENCE) {
      mask.fill(0);
      renderDabMask(mask, x, y, r, h, s, ar, ang, bounds);
      let total = 0;
      let positional = 0;
      mask.forEach((value, i) => {
        total += value;
        positional += value * (i + 1);
      });
      expect(Math.abs(total - sum) / sum).toBeLessThan(1e-4);
      expect(Math.abs(positional - weighted) / weighted).toBeLessThan(1e-4);
    }
  });

  it('evaluates mapping curves like mypaint_mapping_calculate', () => {
    const brush = new CompiledBrush({
      settings: {
        radius_logarithmic: {
          baseValue: 1,
          inputs: {
            pressure: [
              [0, -1],
              [0.5, 0],
              [1, 2],
            ],
          },
        },
      },
    });
    const inputs = new Float64Array(INPUT_COUNT);
    const out = new Float64Array(SETTING_COUNT);
    inputs[I.pressure] = 0.75;
    brush.calculate(inputs, out);
    expect(out[S.radius_logarithmic]).toBeCloseTo(1 + 1, 10);
    inputs[I.pressure] = 0.25;
    brush.calculate(inputs, out);
    expect(out[S.radius_logarithmic]).toBeCloseTo(1 - 0.5, 10);
    expect(brush.isConstant(S.radius_logarithmic)).toBe(false);
    expect(brush.isConstant(S.hardness)).toBe(true);
  });

  it('round-trips .myb files', () => {
    const text = serializeMyb(DEFAULT_BRUSH);
    const parsed = parseMyb(text);
    expect(parsed.ignored).toEqual([]);
    expect(parsed.brush.settings).toEqual(DEFAULT_BRUSH.settings);
    expect(parseMyb('{"version":3,"settings":{"nope":{"base_value":1,"inputs":{}}}}').ignored).toEqual(['nope']);
  });

  it('keeps the latent mix consistent with mix_colors at the extremes', () => {
    const out = new Float64Array(4);
    const red = [1, 0, 0, 1];
    const blue = [0, 0, 1, 1];
    mixColors(libMyPaintPigmentMixer, red, blue, 1, 1, out);
    expect(out[0]).toBeGreaterThan(0.9);
    mixColors(libMyPaintPigmentMixer, red, blue, 0, 0, out);
    expect([...out]).toEqual([0, 0, 1, 1]);
  });

  it('renders the same pixels for the same samples and seed, in any chunking', () => {
    const samples = previewStrokeSamples({ width: 256, height: 128 });
    const whole = render(samples);
    expect(whole.size).toBeGreaterThan(0);
    expect(hashTiles(render(samples))).toBe(hashTiles(whole));
    expect(hashTiles(render(samples, 9 * 3))).toBe(hashTiles(whole));
  });

  it('quantizes recorded samples to float32', () => {
    const recorder = new SampleRecorder();
    const fed = recorder.push({
      x: 0.1,
      y: 0,
      pressure: 1,
      xtilt: 0,
      ytilt: 0,
      dtime: 0.01,
      viewzoom: 1,
      viewrotation: 0,
      barrelRotation: 0,
    });
    expect(fed[0]).toBe(Math.fround(0.1));
    expect(recorder.toArray()[0]).toBe(fed[0]);
  });
});

describe('stroke start', () => {
  it('starts at the first sample instead of being pulled from the origin', () => {
    const state = createDocState(512, 512, 'L');
    const slow = { ...DEFAULT_BRUSH, settings: { ...DEFAULT_BRUSH.settings, slow_tracking: { baseValue: 2 } } };
    const renderer = new StrokeRenderer(
      state,
      { target: { nodeId: 'L' }, brush: resolveBrush({ ...black, brush: slow }), seed: 1, clientId: 'me' },
      libMyPaintPigmentMixer,
    );
    const recorder = new SampleRecorder();
    for (let i = 0; i < 20; i++) {
      renderer.feed(
        recorder.push({
          x: 300 + i * 4,
          y: 300,
          pressure: 0.8,
          xtilt: 0,
          ytilt: 0,
          dtime: i === 0 ? 0 : 0.01,
          viewzoom: 1,
          viewrotation: 0,
          barrelRotation: 0,
        }),
      );
    }
    const layer = renderer.commit().nodes.get('L');
    if (layer?.kind !== 'paint') throw new Error('unreachable');
    // Tiles are 64 px; nothing may be painted in the tiles between the origin and the stroke.
    const painted = [...layer.tiles.keys()].map((key) => [(key % 65536) - 32768, Math.floor(key / 65536) - 32768]);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every(([tx, ty]) => tx! >= 4 && ty! >= 4)).toBe(true);
  });
});
