import { blendModeIndex } from '../../domain/document/blend-mode.ts';
import { maskFill } from '../../domain/document/layer-mask.ts';
import type { DocNode, NodeId } from '../../domain/document/nodes.ts';
import type { DocState } from '../../domain/document/state.ts';
import type { FilterRegistry, FilterSpec } from '../../domain/filters/filter.ts';
import { MAX_GROUP_DEPTH } from './compositor.ts';

/** An enabled layer mask that scales a blending item's opacity per pixel. */
export interface ItemMask {
  readonly nodeId: NodeId;
  /** fix15 value of pixels without a mask tile. */
  readonly fill: number;
}

export type ProgramItem =
  | {
      readonly op: 'layer';
      readonly nodeId: NodeId;
      readonly mode: number;
      readonly opacity: number;
      readonly warp: boolean;
      readonly mask: ItemMask | null;
    }
  | {
      readonly op: 'result';
      readonly layer: number;
      readonly mode: number;
      readonly opacity: number;
      readonly mask: ItemMask | null;
    }
  | { readonly op: 'filterOut'; readonly mode: number; readonly opacity: number; readonly mask: ItemMask | null }
  | { readonly op: 'push' }
  | { readonly op: 'pop'; readonly mode: number; readonly opacity: number; readonly mask: ItemMask | null }
  | { readonly op: 'base'; readonly layer: number };

export type PlanStep =
  /** Runs a program and writes the final composite or a stage layer of the results array. */
  | { readonly kind: 'composite'; readonly target: 'final' | number; readonly program: readonly ProgramItem[] }
  /** Runs the filter pass on a results layer and writes the filter output texture. */
  | {
      readonly kind: 'filter';
      readonly filter: FilterSpec;
      readonly inputLayer: number;
      readonly useSelection: boolean;
    }
  /** Copies the filter output texture into a results layer so later filters can reuse the output texture. */
  | { readonly kind: 'copyFilterOut'; readonly layer: number };

export interface CompositePlan {
  readonly steps: readonly PlanStep[];
  /** Number of results-array layers the plan uses. */
  readonly stageLayers: number;
  /** How far a pixel change can spread through all filters in the plan. */
  readonly margin: number;
}

export interface PlanOptions {
  readonly filters: FilterRegistry;
  readonly warpNodeId: NodeId | null;
  readonly filterPreview: { readonly nodeId: NodeId; readonly filter: FilterSpec } | null;
}

/**
 * Flattens a layer tree into composite steps.
 *
 * Groups without adjustment layers become inline push/pop sequences. A group containing adjustment layers is split
 * at each adjustment: everything below it is composited into a stage layer, the filter runs on that stage, and the
 * next segment starts from the stage and blends the filtered image on top. The group's final stage then takes the
 * place of the group in its parent. Adjustment layers only affect their own group, so such groups are always isolated.
 */
export function planComposite(state: DocState, rootIds: readonly NodeId[], options: PlanOptions): CompositePlan {
  const steps: PlanStep[] = [];
  let nextLayer = 0;
  let margin = 0;
  const allocate = () => nextLayer++;

  let previewLayer = -1;
  const preview = options.filterPreview;
  if (preview && state.nodes.get(preview.nodeId)?.kind === 'paint') {
    const gathered = allocate();
    previewLayer = allocate();
    steps.push({
      kind: 'composite',
      target: gathered,
      program: [{ op: 'layer', nodeId: preview.nodeId, mode: 0, opacity: 1, warp: false, mask: null }],
    });
    steps.push({ kind: 'filter', filter: preview.filter, inputLayer: gathered, useSelection: true });
    steps.push({ kind: 'copyFilterOut', layer: previewLayer });
    margin += options.filters.margin(preview.filter);
  }

  const visible = (node: DocNode) => node.visible && node.opacity > 0;
  const hasAdjustment = (ids: readonly NodeId[]) =>
    ids.some((id) => {
      const node = state.nodes.get(id)!;
      return node.kind === 'adjustment' && visible(node);
    });

  /** Program items for one node inside its parent's program. */
  const compileNode = (node: DocNode, depth: number): ProgramItem[] => {
    const mode = blendModeIndex(node.blendMode);
    const mask = itemMask(node);
    switch (node.kind) {
      case 'paint':
      case 'text':
        if (node.id === preview?.nodeId && previewLayer >= 0)
          return [{ op: 'result', layer: previewLayer, mode, opacity: node.opacity, mask }];
        return [
          { op: 'layer', nodeId: node.id, mode, opacity: node.opacity, warp: node.id === options.warpNodeId, mask },
        ];
      case 'adjustment':
        return [];
      case 'group': {
        if (hasAdjustment(node.childIds)) {
          const layer = compileIsolated(node.childIds, depth + 1);
          return [{ op: 'result', layer, mode, opacity: node.opacity, mask }];
        }
        const children = compileList(node.childIds, depth + 1);
        // A masked group needs its own result to apply the mask to, so it cannot pass through.
        if ((node.passThrough && !mask) || depth >= MAX_GROUP_DEPTH) return scaleOpacity(children, node.opacity);
        return [{ op: 'push' }, ...children, { op: 'pop', mode, opacity: node.opacity, mask }];
      }
    }
  };

  const compileList = (ids: readonly NodeId[], depth: number): ProgramItem[] =>
    ids.flatMap((id) => {
      const node = state.nodes.get(id)!;
      return visible(node) ? compileNode(node, depth) : [];
    });

  /** Compiles a child list that contains adjustment layers and returns its final stage layer. */
  const compileIsolated = (ids: readonly NodeId[], depth: number): number => {
    let program: ProgramItem[] = [];
    let previous = -1;
    let pendingFilter: { filter: FilterSpec; mode: number; opacity: number; mask: ItemMask | null } | null = null;
    const close = (): number => {
      if (pendingFilter) {
        const { filter, ...item } = pendingFilter;
        steps.push({ kind: 'filter', filter, inputLayer: previous, useSelection: false });
        program.unshift({ op: 'filterOut', ...item });
      }
      if (previous >= 0) program.unshift({ op: 'base', layer: previous });
      const layer = allocate();
      steps.push({ kind: 'composite', target: layer, program });
      return layer;
    };
    for (const id of ids) {
      const node = state.nodes.get(id)!;
      if (!visible(node)) continue;
      if (node.kind === 'adjustment') {
        previous = close();
        program = [];
        pendingFilter = {
          filter: node.filter,
          mode: blendModeIndex(node.blendMode),
          opacity: node.opacity,
          mask: itemMask(node),
        };
        margin += options.filters.margin(node.filter);
        continue;
      }
      program.push(...compileNode(node, depth));
    }
    return close();
  };

  if (hasAdjustment(rootIds)) {
    const layer = compileIsolated(rootIds, 0);
    steps.push({ kind: 'composite', target: 'final', program: [{ op: 'base', layer }] });
  } else {
    steps.push({ kind: 'composite', target: 'final', program: compileList(rootIds, 0) });
  }
  return { steps, stageLayers: nextLayer, margin };
}

function itemMask(node: DocNode): ItemMask | null {
  return node.mask?.enabled ? { nodeId: node.id, fill: maskFill(node.mask) } : null;
}

/** Multiplies the opacity of every top-level blending item, which is how pass-through groups apply their opacity. */
function scaleOpacity(items: ProgramItem[], factor: number): ProgramItem[] {
  if (factor === 1) return items;
  let depth = 0;
  return items.map((item) => {
    if (item.op === 'push') depth++;
    if (item.op === 'pop') depth--;
    if (depth > 0 || item.op === 'push' || item.op === 'base') return item;
    return { ...item, opacity: item.opacity * factor };
  });
}
