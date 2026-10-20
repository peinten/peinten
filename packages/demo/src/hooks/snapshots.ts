import type { SnapshotSource } from 'peinten';
import { useSyncExternalStore } from 'react';

/**
 * Reads part of a peinten snapshot from a runtime, document or view. `select` must return a part of the snapshot or a
 * primitive, never a new object, so that unchanged parts keep their identity and the component skips re-rendering.
 */
export function useSnapshot<T, S>(source: SnapshotSource<T>, select: (snapshot: T) => S): S {
  const read = () => select(source.getSnapshot());
  return useSyncExternalStore(source.subscribe, read, read);
}
