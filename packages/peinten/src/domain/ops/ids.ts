// Randomness is not I/O; the global is declared here instead of pulling the DOM lib into the domain layer.
declare const crypto: { randomUUID(): string };

/** Generates an id that is unique across peers. */
export function newId(): string {
  return crypto.randomUUID();
}
