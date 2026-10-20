import * as v from 'valibot';
import { brushSettingsSchema } from '../../domain/brush/myb.ts';
import type { BrushSettings } from '../../domain/brush/settings.ts';
import type { ClientId, NodeId } from '../../domain/document/nodes.ts';
import { nodeIdSchema } from '../../domain/document/schema.ts';
import type { BatchId } from '../../domain/history/toggle.ts';
import type { Operation } from '../../domain/ops/operation.ts';
import { strokeSamplesSchema } from '../../domain/ops/raster-ops.ts';

export const PROTOCOL_VERSION = 1;

/** Position of a commit in the total order. 0 means "before the first commit". */
export type Seq = number;

export interface Commit {
  readonly seq: Seq;
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly ops: readonly Operation[];
}

/** A serialized document (including selections) as of `seq`. */
export interface Snapshot {
  readonly seq: Seq;
  readonly data: Uint8Array;
}

export interface Presence {
  readonly name: string;
  readonly color: string;
  /** Document pixels; null while the pointer is outside every view. */
  readonly cursor: { readonly x: number; readonly y: number } | null;
}

/**
 * A paint-layer stroke still being drawn, relayed without ordering so peers can preview it before its commit
 * arrives. `seed` identifies the stroke: its commit carries a `stroke` operation with the same seed.
 */
export type StrokeProgress =
  | { readonly phase: 'begin'; readonly seed: number; readonly nodeId: NodeId; readonly brush: BrushSettings }
  /** Samples since the previous message, in the `SAMPLE_STRIDE` layout. */
  | { readonly phase: 'samples'; readonly seed: number; readonly samples: Float32Array }
  | { readonly phase: 'end'; readonly seed: number; readonly cancelled: boolean };

export type ClientMessage =
  | {
      readonly t: 'hello';
      readonly protocol: number;
      readonly clientId: ClientId;
      readonly registry: string;
      /** Last commit the client has; null asks for a snapshot. */
      readonly since: Seq | null;
    }
  | { readonly t: 'submit'; readonly batchId: BatchId; readonly ops: readonly Operation[] }
  | { readonly t: 'presence'; readonly state: Presence | null }
  | { readonly t: 'stroke'; readonly progress: StrokeProgress }
  | { readonly t: 'snapshot'; readonly requestId: string; readonly seq: Seq; readonly data: Uint8Array };

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly head: Seq;
      readonly snapshot: Snapshot | null;
      readonly commits: readonly Commit[];
    }
  | { readonly t: 'commit'; readonly commit: Commit }
  | { readonly t: 'reject'; readonly batchId: BatchId; readonly reason: string }
  | { readonly t: 'presence'; readonly clientId: ClientId; readonly state: Presence | null }
  | { readonly t: 'stroke'; readonly clientId: ClientId; readonly progress: StrokeProgress }
  | { readonly t: 'snapshot-request'; readonly requestId: string }
  | { readonly t: 'error'; readonly code: 'protocol-mismatch' | 'registry-mismatch' | 'unauthorized' };

// Operation payloads are checked against the operation registry by whoever applies them.
const operationSchema = v.looseObject({ type: v.string(), id: v.string(), clientId: v.string() });
const seqSchema = v.pipe(v.number(), v.integer(), v.minValue(0));
const idSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const presenceSchema = v.nullable(
  v.object({
    name: v.pipe(v.string(), v.maxLength(64)),
    color: v.pipe(v.string(), v.maxLength(32)),
    cursor: v.nullable(v.object({ x: v.pipe(v.number(), v.finite()), y: v.pipe(v.number(), v.finite()) })),
  }),
);

const seedSchema = v.pipe(v.number(), v.integer());
const strokeProgressSchema = v.variant('phase', [
  v.object({ phase: v.literal('begin'), seed: seedSchema, nodeId: nodeIdSchema, brush: brushSettingsSchema }),
  v.object({ phase: v.literal('samples'), seed: seedSchema, samples: strokeSamplesSchema }),
  v.object({ phase: v.literal('end'), seed: seedSchema, cancelled: v.boolean() }),
]);

export const clientMessageSchema: v.GenericSchema<unknown, ClientMessage> = v.variant('t', [
  v.object({
    t: v.literal('hello'),
    protocol: v.number(),
    clientId: idSchema,
    registry: v.string(),
    since: v.nullable(seqSchema),
  }),
  v.object({ t: v.literal('submit'), batchId: idSchema, ops: v.array(operationSchema) }),
  v.object({ t: v.literal('presence'), state: presenceSchema }),
  v.object({ t: v.literal('stroke'), progress: strokeProgressSchema }),
  v.object({ t: v.literal('snapshot'), requestId: idSchema, seq: seqSchema, data: v.instance(Uint8Array) }),
]) as v.GenericSchema<unknown, ClientMessage>;
