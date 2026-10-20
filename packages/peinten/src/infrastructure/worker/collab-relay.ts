import type { ClientMessage, ServerMessage } from '../../application/collab/protocol.ts';
import type { CollabTransport, TransportStatus } from '../../application/ports/collab.ts';

type ToWorker =
  | { readonly kind: 'message'; readonly message: ServerMessage }
  | { readonly kind: 'status'; readonly status: TransportStatus };
type ToMain = { readonly kind: 'message'; readonly message: ClientMessage } | { readonly kind: 'close' };

/**
 * Main-thread end: keeps the real transport (WebSocket, SDK, BroadcastChannel) on the main thread and relays it
 * through a MessagePort. Returns the port to transfer to the worker.
 */
export function relayTransport(transport: CollabTransport): MessagePort {
  const { port1, port2 } = new MessageChannel();
  const post = (message: ToWorker) => port1.postMessage(message);
  const unsubscribe = [
    transport.subscribe((message) => post({ kind: 'message', message })),
    transport.subscribeStatus((status) => post({ kind: 'status', status })),
  ];
  port1.onmessage = (event: MessageEvent<ToMain>) => {
    if (event.data.kind === 'message') {
      transport.send(event.data.message);
      return;
    }
    for (const stop of unsubscribe) stop();
    transport.close();
    port1.close();
  };
  return port2;
}

/** Worker end: a CollabTransport backed by the port from `relayTransport`. */
export function portTransport(port: MessagePort): CollabTransport {
  const listeners = new Set<(message: ServerMessage) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  let status: TransportStatus = 'connecting';
  port.onmessage = (event: MessageEvent<ToWorker>) => {
    const data = event.data;
    if (data.kind === 'message') {
      for (const listener of listeners) listener(data.message);
      return;
    }
    status = data.status;
    for (const listener of statusListeners) listener(status);
  };
  return {
    send: (message) => port.postMessage({ kind: 'message', message } satisfies ToMain),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    close() {
      port.postMessage({ kind: 'close' } satisfies ToMain);
      port.close();
    },
  };
}
