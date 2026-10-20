import type { ClientMessage, Commit, Seq, ServerMessage, Snapshot } from '../collab/protocol.ts';

export type TransportStatus = 'connecting' | 'open' | 'closed';

/**
 * A client's connection to the sequencer. Implementations deliver messages in order.
 * Each time the status becomes `open` the engine says hello again and resends unconfirmed batches,
 * so transports may reconnect on their own.
 */
export interface CollabTransport {
  send(message: ClientMessage): void;
  subscribe(listener: (message: ServerMessage) => void): () => void;
  /** Calls the listener with the current status right away, then on every change. */
  subscribeStatus(listener: (status: TransportStatus) => void): () => void;
  close(): void;
}

/** The sequencer's side of one client connection. */
export interface PeerLink {
  send(message: ServerMessage): void;
  close(): void;
}

/** Durable storage of commits and snapshots. Methods may be asynchronous. */
export interface CommitLog {
  /** Seq of the last commit, 0 when empty. */
  head(): Seq | Promise<Seq>;
  append(commit: Commit): void | Promise<void>;
  /** Commits after `seq`, or null when they are no longer kept. */
  since(seq: Seq): readonly Commit[] | null | Promise<readonly Commit[] | null>;
  latestSnapshot(): Snapshot | null | Promise<Snapshot | null>;
  /** Commits up to the snapshot's seq may be discarded afterwards. */
  putSnapshot(snapshot: Snapshot): void | Promise<void>;
}
