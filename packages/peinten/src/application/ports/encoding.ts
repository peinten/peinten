import type { SerializedDocument } from '../../domain/document/serialization.ts';

/** Turns the document file format into bytes and back. */
export interface DocumentCodec {
  encode(document: SerializedDocument): Uint8Array;
  /** Returns untrusted data; the caller validates it. */
  decode(bytes: Uint8Array): unknown;
}
