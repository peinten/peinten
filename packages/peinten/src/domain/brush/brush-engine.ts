// Port of libmypaint's mypaint-brush.c stroke state machine (ISC license, Martin Renold and contributors).

import { clamp, hslToRgb, hsvToRgb, modArith, rgbToHsl, rgbToHsv, smallestAngularDifference } from './color.ts';
import { type ColorMixer, mixColors } from './color-mixer.ts';
import type { CompiledBrush } from './mapping.ts';
import { RngDouble } from './rng.ts';
import { I, INPUT_COUNT, S, SETTING_COUNT } from './settings.ts';
import type { DabParams, Surface } from './surface.ts';

const ACTUAL_RADIUS_MIN = 0.2;
const ACTUAL_RADIUS_MAX = 1000;
const GRID_SIZE = 256;
const WGM_EPSILON = 0.001;
const NUM_SMUDGE_BUCKETS = 256;
const radians = (deg: number) => (deg * Math.PI) / 180;
const degrees = (rad: number) => (rad / (2 * Math.PI)) * 360;

// Smudge bucket layout.
const SMUDGE_R = 0;
const SMUDGE_G = 1;
const SMUDGE_B = 2;
const SMUDGE_A = 3;
const PREV_COL_R = 4;
const PREV_COL_G = 5;
const PREV_COL_B = 6;
const PREV_COL_A = 7;
const PREV_COL_RECENTNESS = 8;
const SMUDGE_BUCKET_SIZE = 9;

function expDecay(tConst: number, t: number): number {
  if (tConst <= 0.001) return 0;
  return Math.exp(-t / tConst);
}

/** Brush engine state that changes during a stroke (libmypaint's `states`). */
class BrushState {
  x = 0;
  y = 0;
  pressure = 0;
  partialDabs = 0;
  actualRadius = 0;
  actualX = 0;
  actualY = 0;
  normDxSlow = 0;
  normDySlow = 0;
  normSpeed1Slow = 0;
  normSpeed2Slow = 0;
  stroke = 0;
  strokeStarted = 0;
  customInput = 0;
  actualEllipticalDabRatio = 0;
  actualEllipticalDabAngle = 0;
  directionDx = 0;
  directionDy = 0;
  declination = 0;
  ascension = 0;
  viewzoom = 0;
  viewrotation = 0;
  directionAngleDx = 0;
  directionAngleDy = 0;
  flip = -1;
  gridmapX = 0;
  gridmapY = 0;
  declinationX = 0;
  declinationY = 0;
  dabsPerBasicRadius = 0;
  dabsPerActualRadius = 0;
  dabsPerSecond = 0;
  barrelRotation = 0;
}

/**
 * One stroke of libmypaint's brush engine.
 * Create a new instance per stroke with a seed: the same samples and seed always produce the same pixels.
 */
export class BrushEngine {
  readonly #brush: CompiledBrush;
  readonly #mixer: ColorMixer;
  readonly #rng: RngDouble;
  #state = new BrushState();
  readonly #settings = new Float64Array(SETTING_COUNT);
  readonly #inputs = new Float64Array(INPUT_COUNT);
  readonly #speedGamma = new Float64Array(2);
  readonly #speedM = new Float64Array(2);
  readonly #speedQ = new Float64Array(2);
  readonly #buckets = new Float64Array(NUM_SMUDGE_BUCKETS * SMUDGE_BUCKET_SIZE);
  #randomInput = 0;
  #skip = 0;
  #skipLastX = 0;
  #skipLastY = 0;
  #skippedDtime = 0;
  #resetRequested = true;
  readonly #dab: DabParams = {
    x: 0,
    y: 0,
    radius: 0,
    colorR: 0,
    colorG: 0,
    colorB: 0,
    opaque: 0,
    hardness: 0,
    softness: 0,
    colorA: 1,
    aspectRatio: 1,
    angle: 0,
    lockAlpha: 0,
    colorize: 0,
    posterize: 0,
    posterizeNum: 0,
    paint: 0,
  };
  readonly #color = new Float64Array(3);
  readonly #sampled = new Float64Array(4);
  readonly #mixed = new Float64Array(4);
  readonly #pair = new Float64Array(4);

  constructor(brush: CompiledBrush, mixer: ColorMixer, seed: number) {
    this.#brush = brush;
    this.#mixer = mixer;
    this.#rng = new RngDouble(seed);
    for (let i = 0; i < 2; i++) {
      const gamma = Math.exp(brush.base[i === 0 ? S.speed1_gamma : S.speed2_gamma]!);
      const fix1X = 45;
      const fix1Y = 0.5;
      const fix2X = 45;
      const fix2Dy = 0.015;
      const c1 = Math.log(fix1X + gamma);
      const m = fix2Dy * (fix2X + gamma);
      this.#speedGamma[i] = gamma;
      this.#speedM[i] = m;
      this.#speedQ[i] = fix1Y - m * c1;
    }
  }

  #base(setting: number): number {
    return this.#brush.base[setting]!;
  }

  #setting(setting: number): number {
    return this.#settings[setting]!;
  }

  #reset(): void {
    this.#skip = 0;
    this.#skipLastX = 0;
    this.#skipLastY = 0;
    this.#skippedDtime = 0;
    this.#state = new BrushState();
    this.#buckets.fill(0);
  }

  #directionalOffsets(baseRadius: number, brushFlip: number): [number, number] {
    const st = this.#state;
    const offsetMult = Math.exp(this.#setting(S.offset_multiplier));
    if (!Number.isFinite(offsetMult)) return [0, 0];
    let dx = this.#setting(S.offset_x);
    let dy = this.#setting(S.offset_y);
    const angleAdj = this.#setting(S.offset_angle_adj);
    const angleDeg = (degrees(Math.atan2(st.directionAngleDy, st.directionAngleDx)) - 90) % 360;

    const offsetAngle = this.#setting(S.offset_angle);
    if (offsetAngle) {
      const a = radians(angleDeg + angleAdj);
      dx += Math.cos(a) * offsetAngle;
      dy += Math.sin(a) * offsetAngle;
    }
    const viewRotation = st.viewrotation;
    const offsetAsc = this.#setting(S.offset_angle_asc);
    if (offsetAsc) {
      const a = radians(st.ascension - viewRotation + angleAdj);
      dx += Math.cos(a) * offsetAsc;
      dy += Math.sin(a) * offsetAsc;
    }
    const viewOffset = this.#setting(S.offset_angle_view);
    if (viewOffset) {
      const a = radians(viewRotation + angleAdj);
      dx += Math.cos(-a) * viewOffset;
      dy += Math.sin(-a) * viewOffset;
    }
    const dirMirror = Math.max(0, this.#setting(S.offset_angle_2));
    if (dirMirror) {
      const a = radians(angleDeg + angleAdj * brushFlip);
      dx += Math.cos(a) * dirMirror * brushFlip;
      dy += Math.sin(a) * dirMirror * brushFlip;
    }
    const ascMirror = Math.max(0, this.#setting(S.offset_angle_2_asc));
    if (ascMirror) {
      const a = radians(st.ascension - viewRotation + angleAdj * brushFlip);
      dx += Math.cos(a) * brushFlip * ascMirror;
      dy += Math.sin(a) * brushFlip * ascMirror;
    }
    const viewMirror = Math.max(0, this.#setting(S.offset_angle_2_view));
    if (viewMirror) {
      const a = radians(viewRotation + angleAdj);
      dx += Math.cos(-a) * brushFlip * viewMirror;
      dy += Math.sin(-a) * brushFlip * viewMirror;
    }
    const lim = 3240;
    const baseMul = baseRadius * offsetMult;
    return [clamp(dx * baseMul, -lim, lim), clamp(dy * baseMul, -lim, lim)];
  }

  /** Port of `update_states_and_setting_values`: one simulation step, usually once per dab. */
  #updateStates(
    stepDdab: number,
    stepDx: number,
    stepDy: number,
    stepDpressure: number,
    stepDeclination: number,
    stepAscension: number,
    stepDtimeIn: number,
    stepViewzoom: number,
    stepViewrotation: number,
    stepDeclinationX: number,
    stepDeclinationY: number,
    stepBarrelRotation: number,
  ): void {
    const st = this.#state;
    const inputs = this.#inputs;
    const stepDtime = stepDtimeIn <= 0 ? 0.001 : stepDtimeIn;

    st.x += stepDx;
    st.y += stepDy;
    st.pressure += stepDpressure;
    st.declination += stepDeclination;
    st.ascension += stepAscension;
    st.declinationX += stepDeclinationX;
    st.declinationY += stepDeclinationY;
    st.viewzoom = stepViewzoom;
    const viewrotation = modArith(degrees(stepViewrotation) + 180, 360) - 180;
    st.viewrotation = viewrotation;

    {
      const scale = Math.exp(this.#setting(S.gridmap_scale));
      const scaledSize = scale * GRID_SIZE;
      st.gridmapX =
        (modArith(Math.abs(st.actualX * this.#setting(S.gridmap_scale_x)), scaledSize) / scaledSize) * GRID_SIZE;
      st.gridmapY =
        (modArith(Math.abs(st.actualY * this.#setting(S.gridmap_scale_y)), scaledSize) / scaledSize) * GRID_SIZE;
      if (st.actualX < 0) st.gridmapX = GRID_SIZE - st.gridmapX;
      if (st.actualY < 0) st.gridmapY = GRID_SIZE - st.gridmapY;
    }

    const baseRadius = Math.exp(this.#base(S.radius_logarithmic));
    st.barrelRotation += stepBarrelRotation;
    if (st.pressure <= 0) st.pressure = 0;
    const pressure = st.pressure;

    {
      const lim = 0.0001;
      const threshold = this.#base(S.stroke_threshold);
      if (!st.strokeStarted && pressure > threshold + lim) {
        st.strokeStarted = 1;
        st.stroke = 0;
      } else if (st.strokeStarted && pressure <= threshold * 0.9 + lim) {
        st.strokeStarted = 0;
      }
    }

    const normDx = (stepDx / stepDtime) * st.viewzoom;
    const normDy = (stepDy / stepDtime) * st.viewzoom;
    const normSpeed = Math.hypot(normDx, normDy);
    const normDist = Math.hypot(stepDx / stepDtime / baseRadius, stepDy / stepDtime / baseRadius) * stepDtime;

    inputs[I.pressure] = pressure * Math.exp(this.#base(S.pressure_gain_log));
    inputs[I.speed1] = Math.log(this.#speedGamma[0]! + st.normSpeed1Slow) * this.#speedM[0]! + this.#speedQ[0]!;
    inputs[I.speed2] = Math.log(this.#speedGamma[1]! + st.normSpeed2Slow) * this.#speedM[1]! + this.#speedQ[1]!;
    inputs[I.random] = this.#randomInput;
    inputs[I.stroke] = Math.min(st.stroke, 1);
    const dirAngle = Math.atan2(st.directionDy, st.directionDx);
    inputs[I.direction] = modArith(degrees(dirAngle) + viewrotation + 180, 180);
    const dirAngle360 = Math.atan2(st.directionAngleDy, st.directionAngleDx);
    inputs[I.direction_angle] = (degrees(dirAngle360) + viewrotation + 360) % 360;
    inputs[I.tilt_declination] = st.declination;
    inputs[I.tilt_ascension] = modArith(st.ascension + viewrotation + 180, 360) - 180;
    inputs[I.viewzoom] = this.#base(S.radius_logarithmic) - Math.log(baseRadius / st.viewzoom);
    inputs[I.attack_angle] = smallestAngularDifference(st.ascension, modArith(degrees(dirAngle360) + 90, 360));
    inputs[I.brush_radius] = this.#base(S.radius_logarithmic);
    inputs[I.gridmap_x] = clamp(st.gridmapX, 0, GRID_SIZE);
    inputs[I.gridmap_y] = clamp(st.gridmapY, 0, GRID_SIZE);
    inputs[I.tilt_declinationx] = st.declinationX;
    inputs[I.tilt_declinationy] = st.declinationY;
    inputs[I.custom] = st.customInput;
    inputs[I.barrel_rotation] = modArith(st.barrelRotation, 360);

    this.#brush.calculate(inputs, this.#settings);

    st.dabsPerBasicRadius = this.#setting(S.dabs_per_basic_radius);
    st.dabsPerActualRadius = this.#setting(S.dabs_per_actual_radius);
    st.dabsPerSecond = this.#setting(S.dabs_per_second);

    {
      const fac = 1 - expDecay(this.#setting(S.slow_tracking_per_dab), stepDdab);
      st.actualX += (st.x - st.actualX) * fac;
      st.actualY += (st.y - st.actualY) * fac;
    }
    {
      const fac1 = 1 - expDecay(this.#setting(S.speed1_slowness), stepDtime);
      st.normSpeed1Slow += (normSpeed - st.normSpeed1Slow) * fac1;
      const fac2 = 1 - expDecay(this.#setting(S.speed2_slowness), stepDtime);
      st.normSpeed2Slow += (normSpeed - st.normSpeed2Slow) * fac2;
    }
    {
      let timeConstant = Math.exp(this.#setting(S.offset_by_speed_slowness) * 0.01) - 1;
      if (timeConstant < 0.002) timeConstant = 0.002;
      const fac = 1 - expDecay(timeConstant, stepDtime);
      st.normDxSlow += (normDx - st.normDxSlow) * fac;
      st.normDySlow += (normDy - st.normDySlow) * fac;
    }
    {
      let dx = stepDx * st.viewzoom;
      let dy = stepDy * st.viewzoom;
      const stepInDabtime = Math.hypot(dx, dy);
      const fac = 1 - expDecay(Math.exp(this.#setting(S.direction_filter) * 0.5) - 1, stepInDabtime);
      const dxOld = st.directionDx;
      const dyOld = st.directionDy;
      st.directionAngleDx += (dx - st.directionAngleDx) * fac;
      st.directionAngleDy += (dy - st.directionAngleDy) * fac;
      if ((dxOld - dx) ** 2 + (dyOld - dy) ** 2 > (dxOld + dx) ** 2 + (dyOld + dy) ** 2) {
        dx = -dx;
        dy = -dy;
      }
      st.directionDx += (dx - st.directionDx) * fac;
      st.directionDy += (dy - st.directionDy) * fac;
    }
    {
      const fac = 1 - expDecay(this.#setting(S.custom_input_slowness), 0.1);
      st.customInput += (this.#setting(S.custom_input) - st.customInput) * fac;
    }
    {
      const frequency = Math.exp(-this.#setting(S.stroke_duration_logarithmic));
      const stroke = Math.max(0, st.stroke + normDist * frequency);
      const wrap = 1 + Math.max(0, this.#setting(S.stroke_holdtime));
      if (stroke >= wrap && wrap > 9.9 + 1) st.stroke = 1;
      else if (stroke >= wrap) st.stroke = stroke % wrap;
      else st.stroke = stroke;
    }

    st.actualRadius = clamp(Math.exp(this.#setting(S.radius_logarithmic)), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
    st.actualEllipticalDabRatio = this.#setting(S.elliptical_dab_ratio);
    st.actualEllipticalDabAngle = modArith(this.#setting(S.elliptical_dab_angle) - viewrotation + 180, 180) - 180;
  }

  #smudgeBucket(): number {
    return clamp(Math.round(this.#setting(S.smudge_bucket)), 0, NUM_SMUDGE_BUCKETS - 1) * SMUDGE_BUCKET_SIZE;
  }

  /** Port of `update_smudge_color`. Returns true when the dab must be skipped. */
  #updateSmudgeColor(
    surface: Surface,
    bucket: number,
    smudgeLength: number,
    px: number,
    py: number,
    radius: number,
    legacySmudge: boolean,
    paintFactor: number,
  ): boolean {
    const buckets = this.#buckets;
    let updateFactor = Math.max(0.01, smudgeLength);
    const smudgeLengthLog = this.#setting(S.smudge_length_log);
    const recentness = buckets[bucket + PREV_COL_RECENTNESS]! * updateFactor;
    buckets[bucket + PREV_COL_RECENTNESS] = recentness;
    const margin = 0.0000000000000001;
    const sampled = this.#sampled;
    if (recentness < Math.min(1, (0.5 * updateFactor) ** smudgeLengthLog + margin)) {
      if (recentness === 0) updateFactor = 0;
      buckets[bucket + PREV_COL_RECENTNESS] = 1;
      const smudgeRadius = clamp(
        radius * Math.exp(this.#setting(S.smudge_radius_log)),
        ACTUAL_RADIUS_MIN,
        ACTUAL_RADIUS_MAX,
      );
      surface.getColor(px, py, smudgeRadius, sampled, legacySmudge ? -1 : paintFactor);
      const opLim = this.#setting(S.smudge_transparency);
      if ((opLim > 0 && sampled[3]! < opLim) || (opLim < 0 && sampled[3]! > -opLim)) return true;
      buckets[bucket + PREV_COL_R] = sampled[0]!;
      buckets[bucket + PREV_COL_G] = sampled[1]!;
      buckets[bucket + PREV_COL_B] = sampled[2]!;
      buckets[bucket + PREV_COL_A] = sampled[3]!;
    } else {
      sampled[0] = buckets[bucket + PREV_COL_R]!;
      sampled[1] = buckets[bucket + PREV_COL_G]!;
      sampled[2] = buckets[bucket + PREV_COL_B]!;
      sampled[3] = buckets[bucket + PREV_COL_A]!;
    }
    const r = sampled[0]!;
    const g = sampled[1]!;
    const b = sampled[2]!;
    const a = sampled[3]!;
    if (legacySmudge) {
      const facOld = updateFactor;
      const facNew = (1 - updateFactor) * a;
      buckets[bucket + SMUDGE_R] = facOld * buckets[bucket + SMUDGE_R]! + facNew * r;
      buckets[bucket + SMUDGE_G] = facOld * buckets[bucket + SMUDGE_G]! + facNew * g;
      buckets[bucket + SMUDGE_B] = facOld * buckets[bucket + SMUDGE_B]! + facNew * b;
      buckets[bucket + SMUDGE_A] = clamp(facOld * buckets[bucket + SMUDGE_A]! + facNew, 0, 1);
    } else if (a > WGM_EPSILON * 10) {
      const mixed = mixColors(
        this.#mixer,
        buckets.subarray(bucket, bucket + 4),
        sampled,
        updateFactor,
        paintFactor,
        this.#mixed,
      );
      buckets.set(mixed, bucket);
    } else {
      buckets[bucket + SMUDGE_A] = (buckets[bucket + SMUDGE_A]! + a) / 2;
    }
    return false;
  }

  /** Port of `apply_smudge`. Mixes the smudge color into `#color` and returns the eraser target alpha. */
  #applySmudge(bucket: number, smudgeValue: number, legacySmudge: boolean, paintFactor: number): number {
    const buckets = this.#buckets;
    const color = this.#color;
    const smudgeFactor = Math.min(1, smudgeValue);
    const eraserTargetAlpha = clamp(1 - smudgeFactor + smudgeFactor * buckets[bucket + SMUDGE_A]!, 0, 1);
    if (eraserTargetAlpha > 0) {
      if (legacySmudge) {
        const colFactor = 1 - smudgeFactor;
        for (let i = 0; i < 3; i++) {
          color[i] = (smudgeFactor * buckets[bucket + i]! + colFactor * color[i]!) / eraserTargetAlpha;
        }
      } else {
        const brushColor = this.#pair;
        brushColor.set([color[0]!, color[1]!, color[2]!, 1]);
        const mixed = mixColors(
          this.#mixer,
          buckets.subarray(bucket, bucket + 4),
          brushColor,
          smudgeFactor,
          paintFactor,
          this.#mixed,
        );
        color[0] = mixed[0]!;
        color[1] = mixed[1]!;
        color[2] = mixed[2]!;
      }
    } else {
      color[0] = 1;
      color[1] = 0;
      color[2] = 0;
    }
    return eraserTargetAlpha;
  }

  /** Port of `prepare_and_draw_dab`. */
  #prepareAndDrawDab(surface: Surface): boolean {
    const st = this.#state;
    const brush = this.#brush;
    let opaque = Math.max(0, this.#setting(S.opaque));
    opaque = clamp(opaque * this.#setting(S.opaque_multiply), 0, 1);
    const opaqueLinearize = this.#base(S.opaque_linearize);
    if (opaqueLinearize) {
      let dabsPerPixel = (st.dabsPerActualRadius + st.dabsPerBasicRadius) * 2;
      if (dabsPerPixel < 1) dabsPerPixel = 1;
      dabsPerPixel = 1 + opaqueLinearize * (dabsPerPixel - 1);
      const betaDab = (1 - opaque) ** (1 / dabsPerPixel);
      opaque = 1 - betaDab;
    }

    let x = st.actualX;
    let y = st.actualY;
    const baseRadius = Math.exp(this.#base(S.radius_logarithmic));
    const [ox, oy] = this.#directionalOffsets(baseRadius, Math.trunc(st.flip));
    x += ox;
    y += oy;

    const offsetBySpeed = this.#setting(S.offset_by_speed);
    if (offsetBySpeed) {
      x += (st.normDxSlow * offsetBySpeed * 0.1) / st.viewzoom;
      y += (st.normDySlow * offsetBySpeed * 0.1) / st.viewzoom;
    }
    const offsetByRandom = this.#setting(S.offset_by_random);
    if (offsetByRandom) {
      const amp = Math.max(0, offsetByRandom);
      x += this.#rng.gauss() * amp * baseRadius;
      y += this.#rng.gauss() * amp * baseRadius;
    }

    let radius = st.actualRadius;
    const radiusByRandom = this.#setting(S.radius_by_random);
    if (radiusByRandom) {
      const noise = this.#rng.gauss() * radiusByRandom;
      radius = clamp(Math.exp(this.#setting(S.radius_logarithmic) + noise), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
      const alphaCorrection = (st.actualRadius / radius) ** 2;
      if (alphaCorrection <= 1) opaque *= alphaCorrection;
    }

    const paintFactor = this.#setting(S.paint_mode);
    const legacySmudge = paintFactor <= 0 && brush.isConstant(S.paint_mode);

    const color = this.#color;
    color[0] = this.#base(S.color_h);
    color[1] = this.#base(S.color_s);
    color[2] = this.#base(S.color_v);
    hsvToRgb(color);

    const smudgeLength = this.#setting(S.smudge_length);
    if (smudgeLength < 1 && (this.#setting(S.smudge) !== 0 || !brush.isConstant(S.smudge))) {
      const skip = this.#updateSmudgeColor(
        surface,
        this.#smudgeBucket(),
        smudgeLength,
        Math.trunc(x + 0.5),
        Math.trunc(y + 0.5),
        radius,
        legacySmudge,
        paintFactor,
      );
      if (skip) return false;
    }

    let eraserTargetAlpha = 1;
    const smudgeValue = this.#setting(S.smudge);
    if (smudgeValue > 0) {
      eraserTargetAlpha = this.#applySmudge(this.#smudgeBucket(), smudgeValue, legacySmudge, paintFactor);
    }
    if (this.#setting(S.eraser)) eraserTargetAlpha *= 1 - this.#setting(S.eraser);

    const usingHsv =
      this.#setting(S.change_color_h) || this.#setting(S.change_color_hsv_s) || this.#setting(S.change_color_v);
    const usingHsl = this.#setting(S.change_color_l) || this.#setting(S.change_color_hsl_s);
    if (usingHsv) {
      rgbToHsv(color);
      color[0] = color[0]! + this.#setting(S.change_color_h);
      color[1] = color[1]! + color[1]! * color[2]! * this.#setting(S.change_color_hsv_s);
      color[2] = color[2]! + this.#setting(S.change_color_v);
      hsvToRgb(color);
    }
    if (usingHsl) {
      rgbToHsl(color);
      color[2] = color[2]! + this.#setting(S.change_color_l);
      color[1] =
        color[1]! +
        color[1]! * Math.min(Math.abs(1 - color[2]!), Math.abs(color[2]!)) * 2 * this.#setting(S.change_color_hsl_s);
      hslToRgb(color);
    }

    let hardness = clamp(this.#setting(S.hardness), 0, 1);
    const softness = clamp(this.#setting(S.softness), 0, 1);
    const currentFadeout = radius * (1 - hardness);
    const minFadeout = this.#setting(S.anti_aliasing);
    if (currentFadeout < minFadeout) {
      const opticalRadius = radius - ((1 - hardness) * radius) / 2;
      const hardnessNew = (opticalRadius - minFadeout / 2) / (opticalRadius + minFadeout / 2);
      radius = minFadeout / (1 - hardnessNew);
      hardness = hardnessNew;
    }

    const snapToPixel = this.#setting(S.snap_to_pixel);
    if (snapToPixel > 0) {
      x += (Math.floor(x) + 0.5 - x) * snapToPixel;
      y += (Math.floor(y) + 0.5 - y) * snapToPixel;
      let snappedRadius = Math.round(radius * 2) / 2;
      if (snappedRadius < 0.5) snappedRadius = 0.5;
      if (snapToPixel > 0.9999) snappedRadius -= 0.0001;
      radius += (snappedRadius - radius) * snapToPixel;
    }

    const dab = this.#dab;
    dab.x = x;
    dab.y = y;
    dab.radius = radius;
    dab.colorR = color[0]!;
    dab.colorG = color[1]!;
    dab.colorB = color[2]!;
    dab.opaque = opaque;
    dab.hardness = hardness;
    dab.softness = softness;
    dab.colorA = eraserTargetAlpha;
    dab.aspectRatio = st.actualEllipticalDabRatio;
    dab.angle = st.actualEllipticalDabAngle;
    dab.lockAlpha = this.#setting(S.lock_alpha);
    dab.colorize = this.#setting(S.colorize);
    dab.posterize = this.#setting(S.posterize);
    dab.posterizeNum = this.#setting(S.posterize_num);
    dab.paint = paintFactor;
    return surface.drawDab(dab);
  }

  /** Port of `count_dabs_to`: how many dabs fit between the current state and the next position. */
  #countDabsTo(x: number, y: number, dt: number): number {
    const st = this.#state;
    const baseRadius = clamp(Math.exp(this.#base(S.radius_logarithmic)), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
    if (st.actualRadius === 0) st.actualRadius = baseRadius;
    const dx = x - st.x;
    const dy = y - st.y;
    let dist: number;
    if (st.actualEllipticalDabRatio > 1) {
      const angle = radians(st.actualEllipticalDabAngle);
      const cs = Math.cos(angle);
      const sn = Math.sin(angle);
      const yyr = (dy * cs - dx * sn) * st.actualEllipticalDabRatio;
      const xxr = dy * sn + dx * cs;
      dist = Math.sqrt(yyr * yyr + xxr * xxr);
    } else {
      dist = Math.hypot(dx, dy);
    }
    const res =
      (dist / st.actualRadius) * st.dabsPerActualRadius +
      (dist / baseRadius) * st.dabsPerBasicRadius +
      dt * st.dabsPerSecond;
    return Number.isNaN(res) || res < 0 ? 0 : res;
  }

  /**
   * Port of `mypaint_brush_stroke_to`. Call once per input sample.
   * @param xtilt pen tilt in -1..1 (tilt angle divided by 60 degrees)
   * @param viewrotation radians
   * @param barrelRotation pen twist as a fraction of a full turn (0..1)
   */
  strokeTo(
    surface: Surface,
    xIn: number,
    yIn: number,
    pressureIn: number,
    xtiltIn: number,
    ytiltIn: number,
    dtimeIn: number,
    viewzoom: number,
    viewrotation: number,
    barrelRotation: number,
  ): void {
    const st = this.#state;
    const maxDtime = 5;
    let x = xIn;
    let y = yIn;
    let pressure = pressureIn <= 0 ? 0 : pressureIn;
    let dtime = dtimeIn <= 0 ? 0.0001 : dtimeIn;

    let tiltAscension = 0;
    let tiltDeclination = 90;
    let tiltDeclinationX = 90;
    let tiltDeclinationY = 90;
    if (xtiltIn !== 0 || ytiltIn !== 0) {
      const xtilt = clamp(xtiltIn, -1, 1);
      const ytilt = clamp(ytiltIn, -1, 1);
      tiltAscension = degrees(Math.atan2(-xtilt, ytilt));
      tiltDeclination = 90 - Math.hypot(xtilt, ytilt) * 60;
      tiltDeclinationX = xtilt * 60;
      tiltDeclinationY = ytilt * 60;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e10 || Math.abs(y) > 1e10) {
      x = 0;
      y = 0;
      pressure = 0;
    }

    if (dtime > 0.1 && pressure && st.pressure === 0) {
      // Workaround for tablets that do not report motion without pressure: avoid interpolating pressure.
      this.strokeTo(surface, x, y, 0, 90, 0, dtime - 0.0001, viewzoom, viewrotation, 0);
      dtime = 0.0001;
    }

    if (this.#skip > 0.001) {
      const dist = Math.hypot(this.#skipLastX - x, this.#skipLastY - y);
      this.#skipLastX = x;
      this.#skipLastY = y;
      this.#skippedDtime += dtime;
      this.#skip -= dist;
      dtime = this.#skippedDtime;
      if (this.#skip > 0.001 && !(dtime > maxDtime || this.#resetRequested)) return;
      this.#skip = 0;
      this.#skipLastX = 0;
      this.#skipLastY = 0;
      this.#skippedDtime = 0;
    }

    // The first sample of a stroke initializes the state at the raw position. libmypaint applies tracking noise and
    // slow tracking first, pulling toward the zeroed initial state at (0, 0); MyPaint hides this because its first
    // event usually arrives with a dtime above max_dtime, while strokes here start with a dtime of zero.
    if (!this.#resetRequested) {
      if (this.#base(S.tracking_noise)) {
        const baseRadius = Math.exp(this.#base(S.radius_logarithmic));
        const noise = baseRadius * this.#base(S.tracking_noise);
        if (noise > 0.001) {
          this.#skip = 0.5 * noise;
          this.#skipLastX = x;
          this.#skipLastY = y;
          x += noise * this.#rng.gauss();
          y += noise * this.#rng.gauss();
        }
      }
      const fac = 1 - expDecay(this.#base(S.slow_tracking), 100 * dtime);
      x = st.x + (x - st.x) * fac;
      y = st.y + (y - st.y) * fac;
    }

    if (dtime > maxDtime || this.#resetRequested) {
      this.#resetRequested = false;
      this.#reset();
      const fresh = this.#state;
      this.#randomInput = this.#rng.next();
      fresh.x = x;
      fresh.y = y;
      fresh.pressure = pressure;
      fresh.actualX = x;
      fresh.actualY = y;
      fresh.stroke = 1;
      return;
    }

    let dtimeLeft = dtime;
    let dabsMoved = st.partialDabs;
    let dabsTodo = this.#countDabsTo(x, y, dtime);
    while (dabsMoved + dabsTodo >= 1) {
      let stepDdab: number;
      if (dabsMoved > 0) {
        stepDdab = 1 - dabsMoved;
        dabsMoved = 0;
      } else {
        stepDdab = 1;
      }
      const frac = stepDdab / dabsTodo;
      const stepDtime = frac * dtimeLeft;
      this.#updateStates(
        stepDdab,
        frac * (x - st.x),
        frac * (y - st.y),
        frac * (pressure - st.pressure),
        frac * (tiltDeclination - st.declination),
        frac * smallestAngularDifference(st.ascension, tiltAscension),
        stepDtime,
        viewzoom,
        viewrotation,
        frac * (tiltDeclinationX - st.declinationX),
        frac * (tiltDeclinationY - st.declinationY),
        frac * smallestAngularDifference(st.barrelRotation, barrelRotation * 360),
      );
      st.flip *= -1;
      this.#prepareAndDrawDab(surface);
      this.#randomInput = this.#rng.next();
      dtimeLeft -= stepDtime;
      dabsTodo = this.#countDabsTo(x, y, dtimeLeft);
    }

    this.#updateStates(
      dabsTodo,
      x - st.x,
      y - st.y,
      pressure - st.pressure,
      tiltDeclination - st.declination,
      smallestAngularDifference(st.ascension, tiltAscension),
      dtimeLeft,
      viewzoom,
      viewrotation,
      tiltDeclinationX - st.declinationX,
      tiltDeclinationY - st.declinationY,
      smallestAngularDifference(st.barrelRotation, barrelRotation * 360),
    );
    st.partialDabs = dabsMoved + dabsTodo;
  }
}
