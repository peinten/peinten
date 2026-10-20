import * as v from 'valibot';
import { defineOperation } from '../ops/operation.ts';

export type BatchId = string;

/**
 * Enables or disables an earlier batch. This is how undo and redo travel between peers.
 * The timeline interprets it; `apply` itself leaves the state unchanged.
 */
export interface SetOpEnabledDraft {
  readonly type: 'set-op-enabled';
  readonly batchId: BatchId;
  readonly enabled: boolean;
}

export const SET_OP_ENABLED = 'set-op-enabled';

export const setOpEnabledOp = defineOperation<SetOpEnabledDraft>({
  type: SET_OP_ENABLED,
  schema: v.object({ batchId: v.string(), enabled: v.boolean() }),
  apply: (state) => state,
});
