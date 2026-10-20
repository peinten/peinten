import type { FilterSpec } from '../filters/filter.ts';
import type { TextLayerData } from '../text/text-layer.ts';
import type { MaskMap, TileMap } from '../tiles/tile-map.ts';
import type { BlendMode } from './blend-mode.ts';

export type NodeId = string;
export type ClientId = string;

interface NodeBase {
  readonly id: NodeId;
  readonly parentId: NodeId | null;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
}

export interface PaintLayer extends NodeBase {
  readonly kind: 'paint';
  readonly locked: boolean;
  readonly alphaLocked: boolean;
  readonly tiles: TileMap;
}

export interface GroupLayer extends NodeBase {
  readonly kind: 'group';
  readonly locked: boolean;
  /** Lower index is drawn first, i.e. it is further down the stack. */
  readonly childIds: readonly NodeId[];
  readonly passThrough: boolean;
}

export interface AdjustmentLayer extends NodeBase {
  readonly kind: 'adjustment';
  readonly filter: FilterSpec;
}

export interface TextLayer extends NodeBase {
  readonly kind: 'text';
  readonly locked: boolean;
  readonly text: TextLayerData;
}

export type DocNode = PaintLayer | GroupLayer | AdjustmentLayer | TextLayer;
export type NodeKind = DocNode['kind'];

/** Properties that `update-node` may change on any node kind. */
export interface NodeProps {
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly locked: boolean;
  readonly alphaLocked: boolean;
  readonly passThrough: boolean;
  readonly filter: FilterSpec;
}

/** Selection coverage of one client. */
export type SelectionMask = MaskMap;
