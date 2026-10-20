import type { CommitLog } from '../ports/collab.ts';
import type { Commit, Seq, Snapshot } from './protocol.ts';

/** CommitLog kept in memory. Commits covered by a snapshot are dropped. */
export class MemoryCommitLog implements CommitLog {
  #snapshot: Snapshot | null;
  #commits: Commit[];

  constructor(
    initial: { readonly snapshot: Snapshot | null; readonly commits: readonly Commit[] } = {
      snapshot: null,
      commits: [],
    },
  ) {
    this.#snapshot = initial.snapshot;
    this.#commits = initial.commits.filter((commit) => commit.seq > (initial.snapshot?.seq ?? 0));
  }

  head(): Seq {
    return this.#commits.at(-1)?.seq ?? this.#snapshot?.seq ?? 0;
  }

  append(commit: Commit): void {
    this.#commits.push(commit);
  }

  since(seq: Seq): readonly Commit[] | null {
    if (seq < (this.#snapshot?.seq ?? 0)) return null;
    return this.#commits.filter((commit) => commit.seq > seq);
  }

  latestSnapshot(): Snapshot | null {
    return this.#snapshot;
  }

  putSnapshot(snapshot: Snapshot): void {
    if (snapshot.seq < (this.#snapshot?.seq ?? 0)) return;
    this.#snapshot = snapshot;
    this.#commits = this.#commits.filter((commit) => commit.seq > snapshot.seq);
  }
}
