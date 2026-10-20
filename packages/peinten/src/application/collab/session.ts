import type { BrushSettings } from '../../domain/brush/settings.ts';
import type { ClientId, NodeId } from '../../domain/document/nodes.ts';
import type { Batch } from '../../domain/history/timeline.ts';
import type { BatchId } from '../../domain/history/toggle.ts';
import type { Operation } from '../../domain/ops/operation.ts';
import type { CollabTransport, TransportStatus } from '../ports/collab.ts';
import {
  type Commit,
  PROTOCOL_VERSION,
  type Presence,
  type Seq,
  type ServerMessage,
  type StrokeProgress,
} from './protocol.ts';

export type CollabStatus = 'offline' | 'connecting' | 'online';

export interface Peer extends Presence {
  readonly clientId: ClientId;
}

export interface CollabState {
  readonly status: CollabStatus;
  readonly peers: readonly Peer[];
}

export const OFFLINE: CollabState = { status: 'offline', peers: [] };

/** What a session needs from its document. */
interface CollabHost {
  readonly clientId: ClientId;
  readonly registry: string;
  /** Runs a task in the document's apply queue, i.e. after a stroke in progress has finished. */
  run(task: () => Promise<void>): Promise<void>;
  /** Applies a confirmed batch. Returns false when it toggles a batch outside the history. */
  commit(batch: Batch): Promise<boolean>;
  reject(batchId: BatchId): Promise<void>;
  /** Replaces the confirmed state with a snapshot produced by `snapshot()` on some peer. */
  reset(data: Uint8Array): Promise<void>;
  pending(): readonly Batch[];
  /** The confirmed state, including every client's selection. */
  snapshot(): Uint8Array;
  parse(op: unknown): Operation;
  /** Shows or advances a peer's stroke in progress. */
  previewStroke(clientId: ClientId, progress: StrokeProgress): void;
  /** Drops every peer stroke preview, e.g. when the connection is lost. */
  clearStrokePreviews(): void;
  changed(): void;
  onError(error: unknown): void;
}

/** Presence and the samples of a stroke in progress are sent at most this often. */
const RELAY_INTERVAL_MS = 33;

/**
 * Client side of collaboration. Local batches are applied optimistically and stay pending until the sequencer
 * confirms them; peer commits are inserted before pending batches by the timeline's rollback and replay.
 */
export class CollabSession {
  readonly #transport: CollabTransport;
  readonly #host: CollabHost;
  readonly #unsubscribe: (() => void)[];
  #state: CollabState = { status: 'connecting', peers: [] };
  #peers = new Map<ClientId, Presence>();
  /** Seq of the last applied commit; null until the first welcome. */
  #lastSeq: Seq | null = null;
  /** Commits and submits only flow between a welcome and the next hello. */
  #welcomed = false;
  /** Seq whose toggle already failed once after a resync; failing again means no snapshot can fix it. */
  #resyncedAt: Seq | null = null;
  #presence: Pick<Presence, 'name' | 'color'> | null = null;
  #cursor: Presence['cursor'] = null;
  #cursorTimer: ReturnType<typeof setTimeout> | null = null;
  #cursorDirty = false;
  /** The local stroke being relayed, with samples not sent yet. */
  #stroke: { seed: number; samples: number[]; timer: ReturnType<typeof setTimeout> | null } | null = null;

  constructor(transport: CollabTransport, host: CollabHost) {
    this.#transport = transport;
    this.#host = host;
    this.#unsubscribe = [
      transport.subscribeStatus((status) => this.#onStatus(status)),
      transport.subscribe((message) => {
        // Presence and stroke previews are not part of the document, so they need not wait for a stroke in progress.
        if (message.t === 'presence' || message.t === 'stroke') this.#handleEphemeral(message);
        else void host.run(() => this.#handle(message));
      }),
    ];
  }

  get state(): CollabState {
    return this.#state;
  }

  submit(batch: Batch): void {
    if (this.#welcomed) this.#transport.send({ t: 'submit', batchId: batch.id, ops: batch.ops });
  }

  setPresence(presence: Pick<Presence, 'name' | 'color'> | null): void {
    this.#presence = presence;
    this.#sendPresence();
  }

  setCursor(cursor: Presence['cursor']): void {
    this.#cursor = cursor;
    if (this.#cursorTimer) {
      this.#cursorDirty = true;
      return;
    }
    this.#sendPresence();
    this.#cursorTimer = setTimeout(() => {
      this.#cursorTimer = null;
      if (this.#cursorDirty) this.setCursor(this.#cursor);
      this.#cursorDirty = false;
    }, RELAY_INTERVAL_MS);
  }

  /** Starts relaying a local paint-layer stroke so peers can preview it. */
  beginStroke(stroke: { seed: number; nodeId: NodeId; brush: BrushSettings }): void {
    this.#dropStroke();
    if (!this.#welcomed) return;
    this.#stroke = { seed: stroke.seed, samples: [], timer: null };
    this.#transport.send({ t: 'stroke', progress: { phase: 'begin', ...stroke } });
  }

  /** Queues one quantized sample of the relayed stroke. */
  addStrokeSample(sample: Float32Array): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    stroke.samples.push(...sample);
    stroke.timer ??= setTimeout(() => this.#flushStroke(), RELAY_INTERVAL_MS);
  }

  /** Sends the remaining samples and the end of the relayed stroke. Call before submitting its batch. */
  endStroke(cancelled: boolean): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#flushStroke();
    this.#dropStroke();
    this.#transport.send({ t: 'stroke', progress: { phase: 'end', seed: stroke.seed, cancelled } });
  }

  close(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    if (this.#cursorTimer) clearTimeout(this.#cursorTimer);
    this.#dropStroke();
    this.#host.clearStrokePreviews();
    this.#transport.close();
  }

  #flushStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    if (stroke.timer) clearTimeout(stroke.timer);
    stroke.timer = null;
    if (stroke.samples.length === 0) return;
    this.#transport.send({
      t: 'stroke',
      progress: { phase: 'samples', seed: stroke.seed, samples: Float32Array.from(stroke.samples) },
    });
    stroke.samples = [];
  }

  #dropStroke(): void {
    if (this.#stroke?.timer) clearTimeout(this.#stroke.timer);
    this.#stroke = null;
  }

  #sendPresence(): void {
    if (!this.#welcomed) return;
    this.#transport.send({ t: 'presence', state: this.#presence && { ...this.#presence, cursor: this.#cursor } });
  }

  #setState(status: CollabStatus): void {
    this.#state = { status, peers: [...this.#peers].map(([clientId, presence]) => ({ clientId, ...presence })) };
    this.#host.changed();
  }

  #onStatus(status: TransportStatus): void {
    this.#welcomed = false;
    // Peers that miss the beginning of a stroke cannot preview it, so the stroke is no longer relayed.
    this.#dropStroke();
    this.#host.clearStrokePreviews();
    if (status === 'open') this.#hello(this.#lastSeq);
    this.#peers.clear();
    this.#setState(status === 'closed' ? 'offline' : 'connecting');
  }

  #hello(since: Seq | null): void {
    this.#welcomed = false;
    this.#transport.send({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      clientId: this.#host.clientId,
      registry: this.#host.registry,
      since,
    });
  }

  async #handle(message: ServerMessage): Promise<void> {
    try {
      await this.#dispatch(message);
    } catch (error) {
      // The local state may no longer match the room; stop rather than diverge silently.
      this.#host.onError(error);
      this.close();
      this.#setState('offline');
    }
  }

  async #dispatch(message: ServerMessage): Promise<void> {
    switch (message.t) {
      case 'welcome':
        if (message.snapshot) {
          await this.#host.reset(message.snapshot.data);
          this.#lastSeq = message.snapshot.seq;
        }
        this.#welcomed = true;
        for (const commit of message.commits) await this.#applyCommit(commit);
        if (!this.#welcomed) return;
        for (const batch of this.#host.pending()) this.submit(batch);
        this.#sendPresence();
        this.#setState('online');
        return;
      case 'commit':
        if (this.#welcomed) await this.#applyCommit(message.commit);
        return;
      case 'reject':
        this.#host.onError(new Error(`Batch ${message.batchId} was rejected: ${message.reason}`));
        await this.#host.reject(message.batchId);
        return;
      case 'snapshot-request':
        this.#transport.send({
          t: 'snapshot',
          requestId: message.requestId,
          seq: this.#lastSeq ?? 0,
          data: this.#host.snapshot(),
        });
        return;
      case 'error':
        throw new Error(`The sequencer refused the connection: ${message.code}`);
    }
  }

  #handleEphemeral(message: Extract<ServerMessage, { t: 'presence' | 'stroke' }>): void {
    if (message.clientId === this.#host.clientId) return;
    if (message.t === 'stroke') {
      this.#host.previewStroke(message.clientId, message.progress);
      return;
    }
    if (message.state) this.#peers.set(message.clientId, message.state);
    else this.#peers.delete(message.clientId);
    this.#setState(this.#state.status);
  }

  async #applyCommit(commit: Commit): Promise<void> {
    const last = this.#lastSeq ?? 0;
    if (commit.seq <= last) return;
    if (commit.seq !== last + 1) {
      // A gap means messages were lost; ask for what is missing.
      this.#hello(this.#lastSeq);
      return;
    }
    const ops = commit.ops.map((op) => this.#host.parse(op));
    const applied = await this.#host.commit({ id: commit.batchId, clientId: commit.clientId, ops });
    this.#lastSeq = commit.seq;
    if (applied) return;
    if (this.#resyncedAt === commit.seq) {
      this.#host.onError(new Error(`Commit ${commit.seq} toggles a batch that no snapshot contains; skipped`));
      return;
    }
    // The toggled batch is older than this client's history, so only a fresh snapshot has its effect.
    this.#resyncedAt = commit.seq;
    this.#hello(null);
  }
}
