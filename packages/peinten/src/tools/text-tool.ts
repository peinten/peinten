import type { ITool, OverlayBuilder, ToolContext, ToolPointerEvent } from '../application/tool.ts';
import type { TextLayer } from '../domain/document/nodes.ts';
import { placementAbove, walkNodes } from '../domain/document/state.ts';
import { applyAffine } from '../domain/geometry/affine.ts';
import { ops } from '../domain/ops/factories.ts';
import { contentBounds } from '../domain/raster/bounds.ts';
import { DEFAULT_TEXT_STYLE, type WritingMode } from '../domain/text/text-layer.ts';
import type { Rect, TileMap } from '../domain/tiles/tile-map.ts';

export interface TextToolOptions {
  readonly writingMode: WritingMode;
  readonly fontFamily: string;
  readonly fontSize: number;
}

const DEFAULT_OPTIONS: TextToolOptions = {
  writingMode: 'horizontal-tb',
  fontFamily: DEFAULT_TEXT_STYLE.fontFamily,
  fontSize: DEFAULT_TEXT_STYLE.fontSize,
};

/** Drag distance in screen pixels below which a press counts as a click. */
const CLICK_DISTANCE = 3;
const FRAME_STYLE = { color: [0.3, 0.6, 1, 1], width: 1, outline: true, closed: true } as const;

interface Drag {
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  readonly sx: number;
  readonly sy: number;
  x1: number;
  y1: number;
}

function dragRect(d: Drag): Rect {
  return {
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    width: Math.abs(d.x1 - d.x0),
    height: Math.abs(d.y1 - d.y0),
  };
}

function rectPoints(r: Rect): number[] {
  return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height];
}

/**
 * Creates and selects text layers. A click places point text, a drag creates area text sized to the drag,
 * and pressing on an existing text layer selects it. Editing the text itself is left to the UI via `update-text`.
 */
export class TextTool implements ITool<'text', TextToolOptions> {
  readonly id = 'text';
  readonly defaultOptions = DEFAULT_OPTIONS;
  #options = DEFAULT_OPTIONS;
  #drag: Drag | null = null;
  /** Ink bounds per rendered raster; rasters are immutable, so the identity is a valid key. */
  readonly #bounds = new WeakMap<TileMap, Rect | null>();

  setOptions(options: Partial<TextToolOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  #inkBounds(layer: TextLayer, ctx: ToolContext): Rect | null {
    const raster = ctx.document.textRaster(layer);
    if (!raster) return null;
    if (!this.#bounds.has(raster)) this.#bounds.set(raster, contentBounds(raster, 4));
    return this.#bounds.get(raster) ?? null;
  }

  /** Outline of a text layer in document pixels: the frame for area text, the ink bounds for point text. */
  #outline(layer: TextLayer, ctx: ToolContext): number[] | null {
    const { frame, transform, writingMode } = layer.text;
    if (frame.kind === 'point') {
      const ink = this.#inkBounds(layer, ctx);
      return ink && rectPoints(ink);
    }
    const x = writingMode === 'vertical-rl' ? -frame.width : 0;
    const local = rectPoints({ x, y: 0, width: frame.width, height: frame.height });
    const points: number[] = [];
    for (let i = 0; i < local.length; i += 2) points.push(...applyAffine(transform, local[i]!, local[i + 1]!));
    return points;
  }

  /** The topmost visible text layer whose ink covers the point. */
  #hit(x: number, y: number, ctx: ToolContext): TextLayer | null {
    let hit: TextLayer | null = null;
    walkNodes(ctx.document.state, (node) => {
      if (node.kind !== 'text' || !node.visible) return;
      const b = this.#inkBounds(node, ctx);
      if (b && x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height) hit = node;
    });
    return hit;
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const hit = this.#hit(e.x, e.y, ctx);
    if (hit) {
      ctx.document.setActiveNode(hit.id);
      ctx.requestOverlay();
      return;
    }
    this.#drag = { pointerId: e.pointerId, x0: e.x, y0: e.y, x1: e.x, y1: e.y, sx: e.screenX, sy: e.screenY };
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.x1 = e.x;
    drag.y1 = e.y;
    ctx.requestOverlay();
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const drag = this.#drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    this.#drag = null;
    ctx.requestOverlay();
    const vertical = this.#options.writingMode === 'vertical-rl';
    const isClick = Math.hypot(e.screenX - drag.sx, e.screenY - drag.sy) < CLICK_DISTANCE;
    const r = dragRect(drag);
    const { color } = ctx.resources.get();
    const draft = ops.addTextLayer({
      ...placementAbove(ctx.document.state, ctx.document.activeNodeId),
      text: {
        // Vertical text grows leftwards from its origin, so area text anchors at the right edge.
        transform: [1, 0, 0, 1, isClick ? drag.x0 : vertical ? r.x + r.width : r.x, isClick ? drag.y0 : r.y],
        frame: isClick ? { kind: 'point' } : { kind: 'area', width: r.width, height: r.height },
        writingMode: this.#options.writingMode,
        runs: [
          {
            text: 'Text',
            style: {
              ...DEFAULT_TEXT_STYLE,
              fontFamily: this.#options.fontFamily,
              fontSize: this.#options.fontSize,
              color: [color[0], color[1], color[2], 1],
            },
          },
        ],
      },
    });
    void ctx.document.submit(draft).then(() => ctx.document.setActiveNode(draft.nodeId));
  }

  onPointerCancel(ctx: ToolContext): void {
    this.deactivate(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.#drag = null;
    ctx.requestOverlay();
  }

  drawOverlay(overlay: OverlayBuilder, ctx: ToolContext): void {
    if (this.#drag) overlay.polyline(rectPoints(dragRect(this.#drag)), { ...FRAME_STYLE, dashed: true });
    const active = ctx.document.activeNodeId ? ctx.document.state.nodes.get(ctx.document.activeNodeId) : undefined;
    if (active?.kind !== 'text') return;
    const outline = this.#outline(active, ctx);
    if (outline) overlay.polyline(outline, FRAME_STYLE);
  }
}
