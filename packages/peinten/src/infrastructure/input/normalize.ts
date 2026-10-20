import type { Modifiers, PointerInput } from '../../application/tool.ts';

/**
 * Converts the spherical pen angles (altitudeAngle/azimuthAngle, radians) into tiltX/tiltY degrees,
 * following the Pointer Events specification's conversion.
 */
export function tiltFromAngles(altitude: number, azimuth: number): [number, number] {
  const deg = 180 / Math.PI;
  if (altitude === 0) {
    // Pen lying flat: tilt is ±90 along the azimuth's dominant axis.
    const x =
      Math.abs(azimuth % Math.PI) < Math.PI / 4 || Math.abs(azimuth % Math.PI) > (3 * Math.PI) / 4
        ? 90 * Math.sign(Math.cos(azimuth))
        : 0;
    const y = x === 0 ? 90 * Math.sign(Math.sin(azimuth)) : 0;
    return [x, y];
  }
  const tanAlt = Math.tan(altitude);
  return [Math.atan(Math.cos(azimuth) / tanAlt) * deg, Math.atan(Math.sin(azimuth) / tanAlt) * deg];
}

interface PointerLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly timeStamp: number;
  readonly button: number;
  readonly buttons: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export function modifiersOf(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Modifiers {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/**
 * Normalizes one PointerEvent (or coalesced sample). Browsers differ: some fill only tiltX/tiltY, some only the
 * altitude/azimuth pair, and mice report no pressure while buttons are held.
 */
export function normalizePointer(e: PointerLike, kind: PointerInput['kind'], devicePixelRatio: number): PointerInput {
  const pointerType = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
  let tiltX = e.tiltX || 0;
  let tiltY = e.tiltY || 0;
  if (
    pointerType === 'pen' &&
    tiltX === 0 &&
    tiltY === 0 &&
    e.altitudeAngle !== undefined &&
    e.azimuthAngle !== undefined &&
    e.altitudeAngle < Math.PI / 2
  ) {
    [tiltX, tiltY] = tiltFromAngles(e.altitudeAngle, e.azimuthAngle);
  }
  let pressure = e.pressure;
  if (pointerType === 'mouse') {
    tiltX = 0;
    tiltY = 0;
    pressure = e.buttons !== 0 ? 0.5 : 0;
  }
  return {
    kind,
    pointerId: e.pointerId,
    pointerType,
    screenX: e.offsetX * devicePixelRatio,
    screenY: e.offsetY * devicePixelRatio,
    pressure,
    tiltX,
    tiltY,
    twist: pointerType === 'pen' ? e.twist || 0 : 0,
    time: e.timeStamp,
    button: e.button,
    buttons: e.buttons,
    modifiers: modifiersOf(e),
  };
}
