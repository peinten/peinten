import { MemoryCommitLog } from '../../application/collab/memory-commit-log.ts';
import type { ClientMessage, Commit, ServerMessage, Snapshot } from '../../application/collab/protocol.ts';
import { Sequencer } from '../../application/collab/sequencer.ts';
import type { CollabTransport, TransportStatus } from '../../application/ports/collab.ts';

type Wire =
  | { readonly kind: 'client'; readonly from: string; readonly message: ClientMessage }
  | { readonly kind: 'server'; readonly to: string; readonly message: ServerMessage }
  | { readonly kind: 'bye'; readonly from: string }
  | { readonly kind: 'leader' }
  | { readonly kind: 'who-leads' };

export interface BroadcastChannelTransportOptions {
  /** Tabs with the same room name edit the same document. */
  readonly room: string;
  /** The runtime's `registry`; tabs with a different build are refused. */
  readonly registry: string;
  readonly snapshotInterval?: number;
}

/**
 * Collaboration between tabs of one origin. The tab holding a Web Lock runs the sequencer; the others queue for
 * the lock, and when the leader goes away the next tab takes over, rebuilding the log from the commits it saw.
 */
export function broadcastChannelTransport(options: BroadcastChannelTransportOptions): CollabTransport {
  const name = `peinten:${options.room}`;
  const id = crypto.randomUUID();
  const channel = new BroadcastChannel(name);
  const listeners = new Set<(message: ServerMessage) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  const abort = new AbortController();
  let status: TransportStatus = 'connecting';
  // What this tab has seen, so it can continue the log if it becomes the leader.
  let history: { snapshot: Snapshot | null; commits: Commit[] } = { snapshot: null, commits: [] };

  const setStatus = (next: TransportStatus) => {
    status = next;
    for (const listener of statusListeners) listener(next);
  };
  const post = (wire: Wire) => channel.postMessage(wire);

  const record = (message: ServerMessage) => {
    if (message.t === 'welcome') {
      history = message.snapshot
        ? { snapshot: message.snapshot, commits: [...message.commits] }
        : { snapshot: history.snapshot, commits: [...history.commits, ...message.commits] };
    } else if (message.t === 'commit') {
      history.commits.push(message.commit);
    }
  };

  channel.onmessage = (event: MessageEvent<Wire>) => {
    const wire = event.data;
    if (wire.kind === 'leader') {
      // A new leader knows nothing about this tab: say hello again.
      setStatus('connecting');
      setStatus('open');
    } else if (wire.kind === 'server' && wire.to === id) {
      record(wire.message);
      for (const listener of listeners) listener(wire.message);
    }
  };

  const lead = async () => {
    const sequencer = new Sequencer({
      registry: options.registry,
      log: new MemoryCommitLog(history),
      snapshotInterval: options.snapshotInterval,
    });
    // A second channel object, because a BroadcastChannel never receives its own messages.
    const server = new BroadcastChannel(name);
    const links = new Map<string, ReturnType<Sequencer['connect']>>();
    server.onmessage = (event: MessageEvent<Wire>) => {
      const wire = event.data;
      if (wire.kind === 'who-leads') server.postMessage({ kind: 'leader' } satisfies Wire);
      if (wire.kind === 'bye') {
        links.get(wire.from)?.disconnect();
        links.delete(wire.from);
      }
      if (wire.kind !== 'client') return;
      let link = links.get(wire.from);
      if (!link) {
        const to = wire.from;
        link = sequencer.connect({
          send: (message) => server.postMessage({ kind: 'server', to, message } satisfies Wire),
          close: () => links.delete(to),
        });
        links.set(to, link);
      }
      link.receive(wire.message);
    };
    server.postMessage({ kind: 'leader' } satisfies Wire);
    await new Promise((resolve) => abort.signal.addEventListener('abort', resolve));
    server.close();
  };

  navigator.locks.request(name, { signal: abort.signal }, lead).catch((error: unknown) => {
    if (!abort.signal.aborted) console.error('[peinten] leader election failed', error);
  });
  post({ kind: 'who-leads' });

  const close = () => {
    if (status === 'closed') return;
    post({ kind: 'bye', from: id });
    abort.abort();
    channel.close();
    globalThis.removeEventListener?.('pagehide', close);
    setStatus('closed');
  };
  globalThis.addEventListener?.('pagehide', close);

  return {
    send(message) {
      if (message.t === 'snapshot') {
        const snapshot = { seq: message.seq, data: message.data };
        history = { snapshot, commits: history.commits.filter((commit) => commit.seq > snapshot.seq) };
      }
      post({ kind: 'client', from: id, message });
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
    close,
  };
}
