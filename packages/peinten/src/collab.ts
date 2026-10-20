/**
 * peinten/collab: collaboration protocol, sequencer and transports. Free of DOM and GPU dependencies so a Node
 * server can run the sequencer.
 */
export { MemoryCommitLog } from './application/collab/memory-commit-log.ts';
export type {
  ClientMessage,
  Commit,
  Presence,
  Seq,
  ServerMessage,
  Snapshot,
  StrokeProgress,
} from './application/collab/protocol.ts';
export { Sequencer, type SequencerOptions } from './application/collab/sequencer.ts';
export type { CollabState, CollabStatus, Peer } from './application/collab/session.ts';
export type { CollabTransport, CommitLog, PeerLink, TransportStatus } from './application/ports/collab.ts';
export { coreOperations } from './domain/ops/core.ts';
export { OperationRegistry } from './domain/ops/registry.ts';
export {
  type BroadcastChannelTransportOptions,
  broadcastChannelTransport,
} from './infrastructure/collab/broadcast-channel.ts';
export { decodeMessage, encodeMessage } from './infrastructure/collab/codec.ts';
export { createInMemoryHub, type InMemoryHub, type MemoryTransport } from './infrastructure/collab/in-memory-hub.ts';
