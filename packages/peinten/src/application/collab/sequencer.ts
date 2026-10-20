import * as v from 'valibot';
import type { ClientId } from '../../domain/document/nodes.ts';
import type { Operation } from '../../domain/ops/operation.ts';
import { ApplyQueue } from '../apply-queue.ts';
import type { CommitLog, PeerLink } from '../ports/collab.ts';
import { MemoryCommitLog } from './memory-commit-log.ts';
import {
  type Commit,
  clientMessageSchema,
  PROTOCOL_VERSION,
  type Presence,
  type Seq,
  type ServerMessage,
  type Snapshot,
} from './protocol.ts';

export interface SequencerOptions {
  /** Registry hash every client must match; see `composeRuntime`. */
  readonly registry: string;
  /** Validates operation payloads, typically an `OperationRegistry`. Without it only the envelope is checked. */
  readonly operations?: { parse(input: unknown): Operation };
  readonly log?: CommitLog;
  /** Return false to refuse a batch, e.g. for read-only participants. */
  readonly authorize?: (clientId: ClientId, ops: readonly Operation[]) => boolean;
  /** Asks a participant for a fresh snapshot after this many commits, so the log can be trimmed. */
  readonly snapshotInterval?: number;
  readonly onError?: (error: unknown) => void;
}

interface LinkState {
  readonly peer: PeerLink;
  clientId: ClientId | null;
  /** Welcomed: receives commits and presence. */
  ready: boolean;
  presence: Presence | null;
  /** Seed of the stroke the client is drawing, so peers can be told when it disappears mid-stroke. */
  stroke: number | null;
}

type SnapshotRequest =
  | { readonly purpose: 'join'; readonly joiner: LinkState; readonly responder: LinkState }
  | { readonly purpose: 'compact'; readonly responder: LinkState };

const DEFAULT_SNAPSHOT_INTERVAL = 200;

/**
 * Assigns the total order of commits. It never applies operations, so it needs neither the engine nor a GPU and can
 * run on a server or inside one browser tab. Snapshots for late joiners come from connected participants.
 */
export class Sequencer {
  readonly #options: SequencerOptions;
  readonly #log: CommitLog;
  readonly #queue = new ApplyQueue();
  readonly #links = new Set<LinkState>();
  /** `clientId \n batchId` of every logged commit, so resent batches are not committed twice. */
  readonly #committed = new Set<string>();
  readonly #requests = new Map<string, SnapshotRequest>();
  /** Joiners of an empty room waiting for the first participant's document to become the base. */
  #waiting: LinkState[] = [];
  #nextRequest = 0;

  constructor(options: SequencerOptions) {
    this.#options = options;
    this.#log = options.log ?? new MemoryCommitLog();
    void this.#run(async () => {
      const snapshot = await this.#log.latestSnapshot();
      for (const commit of (await this.#log.since(snapshot?.seq ?? 0)) ?? []) this.#committed.add(dedupeKey(commit));
    });
  }

  /** `receive` accepts untrusted input, e.g. straight from `decodeMessage`; invalid messages are dropped. */
  connect(peer: PeerLink): { receive(message: unknown): void; disconnect(): void } {
    const link: LinkState = { peer, clientId: null, ready: false, presence: null, stroke: null };
    this.#links.add(link);
    return {
      receive: (message) => void this.#run(() => this.#receive(link, message)),
      disconnect: () => void this.#run(() => this.#disconnect(link)),
    };
  }

  #run(task: () => void | Promise<void>): Promise<void> {
    return this.#queue
      .run(task)
      .catch(this.#options.onError ?? ((error) => console.error('[peinten] sequencer', error)));
  }

  async #receive(link: LinkState, input: unknown): Promise<void> {
    if (!this.#links.has(link)) return;
    const parsed = v.safeParse(clientMessageSchema, input);
    if (!parsed.success) return;
    const message = parsed.output;
    switch (message.t) {
      case 'hello':
        if (message.protocol !== PROTOCOL_VERSION) return this.#refuse(link, 'protocol-mismatch');
        if (message.registry !== this.#options.registry) return this.#refuse(link, 'registry-mismatch');
        this.#abandonStroke(link);
        link.clientId = message.clientId;
        link.ready = false;
        return this.#join(link, message.since);
      case 'submit':
        return this.#submit(link, message.batchId, message.ops);
      case 'presence':
        if (!link.ready || !link.clientId) return;
        link.presence = message.state;
        this.#broadcast({ t: 'presence', clientId: link.clientId, state: message.state }, link);
        return;
      case 'stroke':
        if (!link.ready || !link.clientId) return;
        link.stroke = message.progress.phase === 'end' ? null : message.progress.seed;
        this.#broadcast({ t: 'stroke', clientId: link.clientId, progress: message.progress }, link);
        return;
      case 'snapshot':
        return this.#receiveSnapshot(link, message.requestId, { seq: message.seq, data: message.data });
    }
  }

  #refuse(link: LinkState, code: 'protocol-mismatch' | 'registry-mismatch'): void {
    link.peer.send({ t: 'error', code });
    link.peer.close();
    this.#links.delete(link);
  }

  /** Brings a (re)connecting client up to date: missing commits if the log still has them, else a snapshot. */
  async #join(link: LinkState, since: Seq | null): Promise<void> {
    const head = await this.#log.head();
    if (since !== null && since <= head) {
      const commits = await this.#log.since(since);
      if (commits) return this.#welcome(link, null, commits);
    }
    const stored = await this.#log.latestSnapshot();
    if (stored?.seq === head) return this.#welcome(link, stored, []);
    // A participant at the head can provide a snapshot that already includes everything.
    const responder = [...this.#links].find((other) => other.ready && other !== link);
    if (responder) return this.#request({ purpose: 'join', joiner: link, responder });
    if (stored) return this.#welcome(link, stored, (await this.#log.since(stored.seq)) ?? []);
    // An empty room: the first participant's document becomes the base at seq 0; later joiners wait for it.
    if ([...this.#requests.values()].some((request) => request.purpose === 'join')) {
      this.#waiting.push(link);
      return;
    }
    this.#request({ purpose: 'join', joiner: link, responder: link });
  }

  #request(request: SnapshotRequest): void {
    const requestId = `r${this.#nextRequest++}`;
    this.#requests.set(requestId, request);
    request.responder.peer.send({ t: 'snapshot-request', requestId });
  }

  async #receiveSnapshot(link: LinkState, requestId: string, snapshot: Snapshot): Promise<void> {
    const request = this.#requests.get(requestId);
    if (request?.responder !== link) return;
    this.#requests.delete(requestId);
    const head = await this.#log.head();
    if (snapshot.seq > head) return;
    const stored = await this.#log.latestSnapshot();
    if (snapshot.seq >= (stored?.seq ?? 0)) await this.#log.putSnapshot(snapshot);
    if (request.purpose !== 'join') return;
    if (this.#links.has(request.joiner)) {
      const base = snapshot.seq >= (stored?.seq ?? 0) ? snapshot : stored!;
      await this.#welcome(request.joiner, base, (await this.#log.since(base.seq)) ?? []);
    }
    await this.#joinWaiting();
  }

  async #joinWaiting(): Promise<void> {
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const link of waiting) if (this.#links.has(link)) await this.#join(link, null);
  }

  async #welcome(link: LinkState, snapshot: Snapshot | null, commits: readonly Commit[]): Promise<void> {
    link.peer.send({ t: 'welcome', head: await this.#log.head(), snapshot, commits });
    link.ready = true;
    for (const other of this.#links) {
      if (other !== link && other.ready && other.clientId && other.presence)
        link.peer.send({ t: 'presence', clientId: other.clientId, state: other.presence });
    }
  }

  async #submit(link: LinkState, batchId: string, input: readonly Operation[]): Promise<void> {
    const clientId = link.clientId;
    // Clients resend everything unconfirmed after their welcome, so earlier submits can be ignored.
    if (!link.ready || !clientId) return;
    if (this.#committed.has(dedupeKey({ clientId, batchId }))) return;
    const ops: Operation[] = [];
    for (const op of input) {
      try {
        ops.push(this.#options.operations?.parse(op) ?? op);
      } catch (error) {
        link.peer.send({ t: 'reject', batchId, reason: `Invalid ${op.type} operation: ${(error as Error).message}` });
        return;
      }
    }
    if (ops.some((op) => op.clientId !== clientId) || this.#options.authorize?.(clientId, ops) === false) {
      link.peer.send({ t: 'reject', batchId, reason: 'Not authorized' });
      return;
    }
    const commit: Commit = { seq: (await this.#log.head()) + 1, clientId, batchId, ops };
    await this.#log.append(commit);
    this.#committed.add(dedupeKey(commit));
    this.#broadcast({ t: 'commit', commit });
    await this.#maybeCompact(commit.seq, link);
  }

  async #maybeCompact(head: Seq, responder: LinkState): Promise<void> {
    const interval = this.#options.snapshotInterval ?? DEFAULT_SNAPSHOT_INTERVAL;
    const stored = await this.#log.latestSnapshot();
    if (head - (stored?.seq ?? 0) < interval) return;
    if ([...this.#requests.values()].some((request) => request.purpose === 'compact')) return;
    this.#request({ purpose: 'compact', responder });
  }

  #broadcast(message: ServerMessage, except?: LinkState): void {
    for (const link of this.#links) if (link.ready && link !== except) link.peer.send(message);
  }

  /** Tells peers to drop the preview of a stroke whose client left or reconnected while drawing it. */
  #abandonStroke(link: LinkState): void {
    if (link.stroke === null || !link.ready || !link.clientId) return;
    this.#broadcast(
      { t: 'stroke', clientId: link.clientId, progress: { phase: 'end', seed: link.stroke, cancelled: true } },
      link,
    );
    link.stroke = null;
  }

  async #disconnect(link: LinkState): Promise<void> {
    if (!this.#links.delete(link)) return;
    this.#abandonStroke(link);
    if (link.ready && link.clientId && link.presence)
      this.#broadcast({ t: 'presence', clientId: link.clientId, state: null });
    for (const [id, request] of this.#requests) {
      if (request.responder !== link) continue;
      this.#requests.delete(id);
      // Ask someone else on behalf of a joiner that is still waiting.
      if (request.purpose === 'join' && request.joiner !== link && this.#links.has(request.joiner))
        await this.#join(request.joiner, null);
    }
    await this.#joinWaiting();
  }
}

function dedupeKey(commit: Pick<Commit, 'clientId' | 'batchId'>): string {
  return `${commit.clientId}\n${commit.batchId}`;
}
