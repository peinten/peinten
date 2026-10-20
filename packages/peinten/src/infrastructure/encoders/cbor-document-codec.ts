import { Decoder, Encoder } from 'cbor-x';
import type { DocumentCodec } from '../../application/ports/encoding.ts';

/** CBOR self-describe tag 55799, so files can be recognized from their first bytes. */
const SELF_DESCRIBE = new Uint8Array([0xd9, 0xd9, 0xf7]);
// Plain CBOR maps and byte strings, without cbor-x's record extension, so other CBOR readers can open files.
const encoder = new Encoder({ useRecords: false, tagUint8Array: false });
const decoder = new Decoder({ useRecords: false, mapsAsObjects: true });

export const cborDocumentCodec: DocumentCodec = {
  encode(document) {
    const body = encoder.encode(document);
    const bytes = new Uint8Array(SELF_DESCRIBE.length + body.length);
    bytes.set(SELF_DESCRIBE);
    bytes.set(body, SELF_DESCRIBE.length);
    return bytes;
  },
  decode(bytes) {
    // cbor-x unwraps the self-describe tag itself.
    return decoder.decode(bytes);
  },
};
