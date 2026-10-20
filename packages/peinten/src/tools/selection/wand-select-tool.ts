import type { ITool, ToolContext, ToolPointerEvent } from '../../application/tool.ts';
import type { SelectionMode } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';
import { DEFAULT_SELECTION_OPTIONS, resolveSelectionMode, type SelectionToolOptions } from './selection-mode.ts';
import { SelectionMove } from './selection-move.ts';

export interface WandToolOptions extends SelectionToolOptions {
  /** Per-channel difference allowed from the clicked color, 0..1. */
  readonly tolerance: number;
  /** Select only pixels connected to the clicked one. */
  readonly contiguous: boolean;
}

export interface WandToolUIState {
  /** False when the active node is not a paint layer, which the wand cannot sample. */
  readonly canSample: boolean;
}

/** Magic wand: selects pixels of the active paint layer similar to the clicked one. */
export class WandSelectTool implements ITool<'select-wand', WandToolOptions, WandToolUIState> {
  readonly id = 'select-wand';
  readonly defaultOptions: WandToolOptions = { ...DEFAULT_SELECTION_OPTIONS, tolerance: 0.1, contiguous: true };
  #options = this.defaultOptions;
  #canSample = true;
  readonly #move = new SelectionMove();

  setOptions(options: Partial<WandToolOptions>): void {
    this.#options = { ...this.#options, ...options };
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const mode = resolveSelectionMode(this.#options.mode, e.modifiers);
    if (!this.#move.press(e, mode, ctx)) this.#select(e, mode, ctx);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.#move.drag(e, ctx);
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    // A click inside the selection samples there, as it would anywhere else.
    if (this.#move.release(e, ctx) === 'click') this.#select(e, 'replace', ctx);
  }

  onPointerCancel(ctx: ToolContext): void {
    this.deactivate(ctx);
  }

  deactivate(ctx: ToolContext): void {
    this.#move.cancel(ctx);
  }

  #select(e: ToolPointerEvent, mode: SelectionMode, ctx: ToolContext): void {
    const nodeId = ctx.document.activeNodeId;
    const canSample = nodeId !== null && ctx.document.state.nodes.get(nodeId)?.kind === 'paint';
    if (canSample !== this.#canSample) {
      this.#canSample = canSample;
      ctx.notifyUIState();
    }
    if (!canSample || nodeId === null) return;
    void ctx.document.submit(
      ops.selectWand({
        mode,
        nodeId,
        x: e.x,
        y: e.y,
        tolerance: this.#options.tolerance,
        contiguous: this.#options.contiguous,
      }),
    );
  }

  getUIState(): WandToolUIState {
    return { canSample: this.#canSample };
  }
}
