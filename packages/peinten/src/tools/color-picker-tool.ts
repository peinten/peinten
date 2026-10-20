import type { ITool, ToolContext, ToolPointerEvent } from '../application/tool.ts';
import type { DocNode, NodeId } from '../domain/document/nodes.ts';
import { tileKey } from '../domain/tiles/tile.ts';

const TILE = 64;

/**
 * Picks the color under the pointer into the shared resources.
 * Visible paint and text layers are flattened with normal blending for the sampled pixel; blend modes and
 * adjustment layers are not applied, which keeps picking synchronous and independent of the GPU.
 */
export class ColorPickerTool implements ITool<'color-picker', Record<string, never>> {
  readonly id = 'color-picker';
  readonly defaultOptions = {};
  #pointerId: number | null = null;

  #pick(e: ToolPointerEvent, ctx: ToolContext): void {
    const state = ctx.document.state;
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
    const key = tileKey(Math.floor(x / TILE), Math.floor(y / TILE));
    const offset = ((y % TILE) * TILE + (x % TILE)) * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    const visit = (ids: readonly NodeId[], opacity: number) => {
      for (const id of ids) {
        const node: DocNode = state.nodes.get(id)!;
        if (!node.visible) continue;
        if (node.kind === 'group') {
          visit(node.childIds, opacity * node.opacity);
          continue;
        }
        const tiles =
          node.kind === 'paint' ? node.tiles : node.kind === 'text' ? ctx.document.textRaster(node) : undefined;
        const tile = tiles?.get(key);
        if (!tile) continue;
        const k = (opacity * node.opacity) / 32768;
        const sa = tile[offset + 3]! * k;
        r = tile[offset]! * k + r * (1 - sa);
        g = tile[offset + 1]! * k + g * (1 - sa);
        b = tile[offset + 2]! * k + b * (1 - sa);
        a = sa + a * (1 - sa);
      }
    };
    visit(state.rootIds, 1);
    if (a <= 0) return;
    ctx.resources.set({ color: [r / a, g / a, b / a] });
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.#pointerId = e.pointerId;
    this.#pick(e, ctx);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.#pointerId === e.pointerId) this.#pick(e, ctx);
  }

  onPointerUp(): void {
    this.#pointerId = null;
  }

  onPointerCancel(): void {
    this.#pointerId = null;
  }
}
