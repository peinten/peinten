/**
 * Returns `next`, reusing every part of `prev` that is deeply equal. Snapshots that are rebuilt from scratch (the
 * runtime snapshot, or any snapshot copied across the worker boundary) get reference stability back this way, so UI
 * selectors skip unchanged parts.
 * Objects with a numeric `version` (thumbnails) are compared by version only; the duplicate bitmap is closed.
 */
export function preserve<T>(prev: T, next: T): T {
  if (prev === next || typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    return Object.is(prev, next) ? prev : next;
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  if (typeof p.version === 'number' && p.version === n.version && 'bitmap' in p) {
    (n.bitmap as { close?: () => void } | undefined)?.close?.();
    return prev;
  }
  if (Object.getPrototypeOf(next) !== Object.prototype && !Array.isArray(next)) return next;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = Array.isArray(next) ? ([] as unknown as Record<string, unknown>) : {};
  for (const key of keys) {
    const value = preserve(p[key], n[key]);
    out[key] = value;
    if (value !== p[key]) same = false;
  }
  return same ? prev : (out as T);
}
