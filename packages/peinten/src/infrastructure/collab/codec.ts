import { Decoder, Encoder } from 'cbor-x';
import type { ClientMessage, ServerMessage } from '../../application/collab/protocol.ts';

// Typed arrays keep their type through CBOR tags, so stroke samples and tiles need no conversion.
const encoder = new Encoder({ useRecords: false });
const decoder = new Decoder({ useRecords: false, mapsAsObjects: true });

/** Encodes a collaboration message for byte-oriented transports such as WebSocket. */
export function encodeMessage(message: ClientMessage | ServerMessage): Uint8Array<ArrayBuffer> {
  // cbor-x allocates a fresh, non-shared buffer, so the result can go straight to `WebSocket.send`.
  return encoder.encode(message) as Uint8Array<ArrayBuffer>;
}

/** Decodes bytes from `encodeMessage`. The result is untrusted: `Sequencer` validates what it receives. */
export function decodeMessage(bytes: Uint8Array): unknown {
  return decoder.decode(bytes);
}
