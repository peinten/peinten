import type { ClientId } from '../document/nodes.ts';
import type { DocState } from '../document/state.ts';
import type { Operation } from '../ops/operation.ts';
import { type BatchId, SET_OP_ENABLED, type SetOpEnabledDraft } from './toggle.ts';

/** Operations dispatched together. They are applied atomically and undone as one unit. */
export interface Batch {
  readonly id: BatchId;
  readonly clientId: ClientId;
  readonly ops: readonly Operation[];
}

export type ApplyOperation = (state: DocState, op: Operation) => DocState | Promise<DocState>;

interface Entry {
  readonly batch: Batch;
  confirmed: boolean;
  before: DocState;
  after: DocState;
}

export interface TimelineOptions {
  readonly apply: ApplyOperation;
  /** How many confirmed batches stay undoable. 0 keeps none. */
  readonly limit: number;
  /** Called when a batch is skipped because one of its operations failed. */
  readonly onSkip?: (batch: Batch, error: unknown) => void;
}

function toggleOf(batch: Batch): SetOpEnabledDraft | null {
  const op = batch.ops[0];
  return batch.ops.length === 1 && op?.type === SET_OP_ENABLED ? (op as unknown as SetOpEnabledDraft) : null;
}

/**
 * Ordered log of batches with the state before and after each one.
 *
 * Confirmed batches form a prefix in the order chosen by the sequencer. Pending local batches follow them.
 * Whenever something changes in the middle (a peer's commit lands before pending batches, a batch is toggled,
 * a pending batch is rejected), the log rolls back to the state before the earliest affected entry and re-applies
 * the rest. Tiles are immutable, so rolling back only swaps references.
 */
export class Timeline {
  readonly #options: TimelineOptions;
  #entries: Entry[] = [];
  #base: DocState;

  constructor(initial: DocState, options: TimelineOptions) {
    this.#base = initial;
    this.#options = options;
  }

  /** State including pending local batches. This is what the user sees. */
  get state(): DocState {
    return this.#entries.at(-1)?.after ?? this.#base;
  }

  /** State including confirmed batches only. */
  get confirmedState(): DocState {
    return this.#entries.findLast((entry) => entry.confirmed)?.after ?? this.#base;
  }

  has(batchId: BatchId): boolean {
    return this.#entries.some((entry) => entry.batch.id === batchId);
  }

  isEnabled(batchId: BatchId): boolean {
    return this.#enabledFlags().get(batchId) ?? true;
  }

  /**
   * Appends a local batch that the sequencer has not confirmed yet.
   * `precomputed` lets a live stroke reuse the tiles it already rendered.
   * Returns false when the batch toggles a batch that is no longer in the log.
   */
  async local(batch: Batch, precomputed?: DocState): Promise<boolean> {
    return this.#insert(batch, this.#entries.length, false, precomputed);
  }

  /** Records a batch confirmed by the sequencer. Returns false when it toggles a batch outside the log. */
  async commit(batch: Batch): Promise<boolean> {
    const firstPending = this.#entries.findIndex((entry) => !entry.confirmed);
    if (firstPending !== -1 && this.#entries[firstPending]!.batch.id === batch.id) {
      this.#entries[firstPending]!.confirmed = true;
      this.#trim();
      return true;
    }
    const duplicate = this.#entries.findIndex((entry) => entry.batch.id === batch.id);
    if (duplicate !== -1 && this.#entries[duplicate]!.confirmed) return true;
    if (duplicate !== -1) this.#entries.splice(duplicate, 1);
    const insertAt = firstPending === -1 ? this.#entries.length : firstPending;
    const ok = await this.#insert(batch, insertAt, true, undefined, duplicate === -1 ? undefined : duplicate);
    this.#trim();
    return ok;
  }

  /** Local batches the sequencer has not confirmed yet, in submission order. */
  pending(): Batch[] {
    return this.#entries.filter((entry) => !entry.confirmed).map((entry) => entry.batch);
  }

  /**
   * Replaces the confirmed history with a snapshot state, as when joining a session.
   * Pending batches are re-applied on top; confirmed batches can no longer be toggled.
   */
  async reset(state: DocState): Promise<void> {
    this.#base = state;
    this.#entries = this.#entries.filter((entry) => !entry.confirmed);
    await this.#recompute(0);
  }

  /** Drops a pending batch the sequencer refused. */
  async reject(batchId: BatchId): Promise<void> {
    const index = this.#entries.findIndex((entry) => !entry.confirmed && entry.batch.id === batchId);
    if (index === -1) return;
    this.#entries.splice(index, 1);
    await this.#recompute(index);
  }
  async #insert(
    batch: Batch,
    index: number,
    confirmed: boolean,
    precomputed?: DocState,
    removedAt?: number,
  ): Promise<boolean> {
    const toggle = toggleOf(batch);
    const before = this.#entries[index - 1]?.after ?? this.#base;
    const entry: Entry = { batch, confirmed, before, after: before };
    this.#entries.splice(index, 0, entry);
    let from = removedAt === undefined ? index : Math.min(index, removedAt);
    if (toggle) {
      const target = this.#entries.findIndex((e) => e.batch.id === toggle.batchId);
      if (target === -1 || target > index) {
        if (removedAt !== undefined) await this.#recompute(Math.min(index, removedAt));
        return false;
      }
      from = Math.min(from, target);
    }
    if (from === index && index === this.#entries.length - 1 && !toggle) {
      entry.after = precomputed ?? (await this.#applyBatch(before, batch));
      return true;
    }
    await this.#recompute(from);
    return true;
  }

  async #recompute(from: number): Promise<void> {
    const enabled = this.#enabledFlags();
    let state = this.#entries[from - 1]?.after ?? this.#base;
    for (let i = from; i < this.#entries.length; i++) {
      const entry = this.#entries[i]!;
      entry.before = state;
      if (!toggleOf(entry.batch) && (enabled.get(entry.batch.id) ?? true)) {
        state = await this.#applyBatch(state, entry.batch);
      }
      entry.after = state;
    }
  }

  /** The latest toggle of each batch wins. */
  #enabledFlags(): Map<BatchId, boolean> {
    const flags = new Map<BatchId, boolean>();
    for (const entry of this.#entries) {
      const toggle = toggleOf(entry.batch);
      if (toggle) flags.set(toggle.batchId, toggle.enabled);
    }
    return flags;
  }

  async #applyBatch(state: DocState, batch: Batch): Promise<DocState> {
    let next = state;
    try {
      for (const op of batch.ops) next = await this.#options.apply(next, op);
      return next;
    } catch (error) {
      // Batches are atomic: a failing operation discards the whole batch on every peer alike.
      this.#options.onSkip?.(batch, error);
      return state;
    }
  }

  /** Drops the oldest confirmed entries beyond the limit. Their effect is folded into the base state. */
  #trim(): void {
    let confirmed = this.#entries.filter((entry) => entry.confirmed).length;
    while (confirmed > this.#options.limit && this.#entries[0]?.confirmed) {
      this.#base = this.#entries.shift()!.after;
      confirmed--;
    }
  }
}
