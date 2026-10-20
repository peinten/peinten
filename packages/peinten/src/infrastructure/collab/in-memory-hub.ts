import type { ClientMessage, ServerMessage } from '../../application/collab/protocol.ts';
import { Sequencer, type SequencerOptions } from '../../application/collab/sequencer.ts';
import type { CollabTransport, TransportStatus } from '../../application/ports/collab.ts';

/** A transport to the hub that tests can take offline and back. */
export interface MemoryTransport extends CollabTransport {
  setOnline(online: boolean): void;
}

export interface InMemoryHub {
  readonly sequencer: Sequencer;
  connect(): MemoryTransport;
  /**
   * Delivers queued messages until every queue is empty and pending async work has run.
   * `random` picks which queue delivers next, varying the interleaving between clients while each direction of each
   * connection stays in order, as on a real network.
   */
  settle(random?: () => number): Promise<void>;
}

interface Connection {
  readonly toServer: ClientMessage[];
  readonly toClient: ServerMessage[];
  deliverToServer(message: ClientMessage): void;
  deliverToClient(message: ServerMessage): void;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** One sequencer and any number of transports, all in memory. For tests and examples. */
export function createInMemoryHub(options: SequencerOptions): InMemoryHub {
  const sequencer = new Sequencer(options);
  const connections = new Set<Connection>();

  const connect = (): MemoryTransport => {
    const listeners = new Set<(message: ServerMessage) => void>();
    const statusListeners = new Set<(status: TransportStatus) => void>();
    let status: TransportStatus = 'connecting';
    let peer: ReturnType<Sequencer['connect']> | null = null;
    /** The sequencer closed the link; what it sent before still arrives. */
    let closing = false;
    const setStatus = (next: TransportStatus) => {
      status = next;
      for (const listener of statusListeners) listener(next);
    };
    const connection: Connection = {
      toServer: [],
      toClient: [],
      deliverToServer: (message) => peer?.receive(structuredClone(message)),
      deliverToClient: (message) => {
        const copy = structuredClone(message);
        for (const listener of listeners) listener(copy);
        if (closing && connection.toClient.length === 0) goOffline('closed');
      },
    };
    connections.add(connection);
    const goOffline = (next: TransportStatus) => {
      closing = false;
      peer?.disconnect();
      peer = null;
      // Messages in flight are lost with the connection.
      connection.toServer.length = 0;
      connection.toClient.length = 0;
      setStatus(next);
    };
    const goOnline = () => {
      peer = sequencer.connect({
        send: (message) => connection.toClient.push(message),
        close: () => {
          closing = true;
        },
      });
      setStatus('open');
    };
    goOnline();
    return {
      send: (message) => {
        if (peer) connection.toServer.push(message);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      subscribeStatus(listener) {
        statusListeners.add(listener);
        listener(status);
        return () => statusListeners.delete(listener);
      },
      close: () => {
        goOffline('closed');
        connections.delete(connection);
      },
      setOnline: (online) => {
        if (online === (peer !== null)) return;
        if (online) goOnline();
        else goOffline('connecting');
      },
    };
  };

  const settle = async (random = () => 0) => {
    for (;;) {
      await tick();
      const queues = [...connections].flatMap((c) => [
        ...(c.toServer.length ? [() => c.deliverToServer(c.toServer.shift()!)] : []),
        ...(c.toClient.length ? [() => c.deliverToClient(c.toClient.shift()!)] : []),
      ]);
      if (queues.length === 0) return;
      queues[Math.floor(random() * queues.length)]!();
    }
  };

  return { sequencer, connect, settle };
}
