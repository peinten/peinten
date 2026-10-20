import type * as v from 'valibot';
import type { ClientId } from '../document/nodes.ts';
import type { DocState } from '../document/state.ts';
import type { OpContext, PrepareContext } from './context.ts';

export type OpId = string;

/** The payload of an operation as created by `ops` factories. */
export interface OperationDraft {
  readonly type: string;
}

/** Fields stamped by the document when a draft is dispatched. */
export interface OperationStamp {
  readonly id: OpId;
  readonly clientId: ClientId;
}

/** A dispatched operation. Deterministic and structured-clone friendly. */
export type Operation<D extends OperationDraft = OperationDraft> = D & OperationStamp;

/**
 * Describes how one operation type is validated and applied.
 * `apply` must be deterministic and must not mutate `state`.
 */
export interface OperationDefinition<D extends OperationDraft = OperationDraft> {
  readonly type: D['type'];
  /**
   * Raise it when `schema` or `apply` changes what an existing operation means. Collaborators must run the same
   * version: the registry hash includes it, so peers with another version are refused instead of diverging.
   * Defaults to 1.
   */
  readonly version?: number;
  /** Validates the payload, excluding `type`, `id` and `clientId`. */
  readonly schema: v.GenericSchema<unknown, Omit<D, 'type'>>;
  /**
   * Runs once on the issuing client before the operation is sent.
   * Used to embed environment-dependent results so every peer applies the same data.
   */
  prepare?(draft: D, ctx: PrepareContext): Promise<D>;
  apply(state: DocState, op: Operation<D>, ctx: OpContext): DocState | Promise<DocState>;
}

// The draft type appears in both input and output positions, so only `any` accepts every concrete definition.
// biome-ignore lint/suspicious/noExplicitAny: required for heterogeneous operation lists
export type AnyOperationDefinition = OperationDefinition<any>;

/** Identity helper that gives `defineOperation` callers full type inference. */
export function defineOperation<D extends OperationDraft>(definition: OperationDefinition<D>): OperationDefinition<D> {
  return definition;
}

/**
 * Thrown by `apply` when an operation no longer makes sense against the current state,
 * for example after a concurrent peer removed its target. The operation is then skipped on every peer.
 */
export class OperationConflictError extends Error {
  override readonly name = 'OperationConflictError';
}
