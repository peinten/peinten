import type { ITool, OverlayBuilder, ToolContext, ToolKeyEvent, ToolPointerEvent } from '../../application/tool.ts';
import type { NodeId, TextLayer } from '../../domain/document/nodes.ts';
import { multiplyAffine } from '../../domain/geometry/affine.ts';
import { ops } from '../../domain/ops/factories.ts';
import { contentBounds } from '../../domain/raster/bounds.ts';
import { intersectRect, type Rect } from '../../domain/tiles/tile-map.ts';
import { AffineMode } from './affine.ts';
import { MeshMode } from './mesh.ts';
import type { TransformMode } from './mode.ts';
import { PerspectiveMode } from './perspective.ts';

export type TransformModeName = 'affine' | 'perspective' | 'mesh';
export type TransformCommand = 'commit' | 'cancel' | 'flip-x' | 'flip-y';

export interface TransformOptions {
  readonly mode: TransformModeName;
  /** Control cells per side in mesh mode. */
  readonly meshSize: number;
}

export interface TransformUIState {
  readonly active: boolean;
  /** Why no transform could start, e.g. an empty layer. */
  readonly message: string | null;
}

interface Session {
  readonly nodeId: NodeId;
  readonly text: TextLayer | null;
  readonly source: Rect;
  mode: TransformMode;
  changed: boolean;
}

/**
 * Transforms the selected content of the active layer (or the whole layer) with affine, perspective or mesh mapping.
 * Changes are previewed on the GPU and committed as one `warp` operation, so peers resample identically on the CPU.
 * Affine transforms of text layers stay editable by updating the text layer's matrix instead.
 * Enter or the commit command applies, Escape or the cancel command discards.
 */
export class TransformTool implements ITool<'transform', TransformOptions, TransformUIState, TransformCommand> {
  readonly id = 'transform';
  readonly defaultOptions: TransformOptions = { mode: 'affine', meshSize: 4 };
  #options = this.defaultOptions;
  #session: Session | null = null;
  #message: string | null = null;

  #setMessage(message: string | null, ctx: ToolContext): void {
    if (message === this.#message) return;
    this.#message = message;
    ctx.notifyUIState();
  }

  #createMode(source: Rect, corners: readonly number[] | null): TransformMode {
    const start = corners ?? [
      source.x,
      source.y,
      source.x + source.width,
      source.y,
      source.x + source.width,
      source.y + source.height,
      source.x,
      source.y + source.height,
    ];
    switch (this.#options.mode) {
      case 'affine':
        return corners ? AffineMode.fromCorners(source, corners) : new AffineMode(source);
      case 'perspective':
        return new PerspectiveMode(start);
      case 'mesh':
        return new MeshMode(start, this.#options.meshSize);
    }
  }

  #start(ctx: ToolContext): Session | null {
    const doc = ctx.document;
    const nodeId = doc.activeNodeId;
    const node = nodeId ? doc.state.nodes.get(nodeId) : undefined;
    if (!node || (node.kind !== 'paint' && node.kind !== 'text') || node.locked) {
      this.#setMessage('Select an unlocked paint or text layer to transform.', ctx);
      return null;
    }
    const tiles = node.kind === 'paint' ? node.tiles : doc.textRaster(node);
    const content = tiles ? contentBounds(tiles, 4) : null;
    const selection = node.kind === 'paint' && doc.selection ? contentBounds(doc.selection, 1) : null;
    const docRect = { x: 0, y: 0, width: doc.state.width, height: doc.state.height };
    const area = selection ?? content;
    const source = area ? intersectRect(area, docRect) : null;
    if (!source) {
      this.#setMessage('Nothing to transform on this layer.', ctx);
      return null;
    }
    this.#setMessage(null, ctx);
    const session: Session = {
      nodeId: node.id,
      text: node.kind === 'text' ? node : null,
      source,
      mode: this.#createMode(source, null),
      changed: false,
    };
    this.#session = session;
    this.#preview(ctx);
    ctx.notifyUIState();
    return session;
  }

  #preview(ctx: ToolContext): void {
    const session = this.#session;
    ctx.preview.setWarp(session ? { nodeId: session.nodeId, source: session.source, mesh: session.mode.mesh() } : null);
    ctx.requestOverlay();
  }

  #end(ctx: ToolContext): void {
    this.#session = null;
    this.#preview(ctx);
    ctx.notifyUIState();
  }

  activate(ctx: ToolContext): void {
    this.#start(ctx);
  }

  deactivate(ctx: ToolContext): void {
    if (this.#session) this.#end(ctx);
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (e.button !== 0) return;
    const session = this.#session ?? this.#start(ctx);
    session?.mode.begin(e, ctx);
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const session = this.#session;
    if (!session || e.buttons === 0) return;
    session.mode.drag(e, ctx);
    session.changed = true;
    this.#preview(ctx);
  }

  onPointerUp(): void {
    this.#session?.mode.end();
  }

  onPointerCancel(): void {
    this.#session?.mode.end();
  }

  onKeyDown(e: ToolKeyEvent, ctx: ToolContext): void {
    if (e.key === 'Enter') this.runCommand('commit', ctx);
    else if (e.key === 'Escape') this.runCommand('cancel', ctx);
  }

  setOptions(options: Partial<TransformOptions>, ctx: ToolContext | null): void {
    const previous = this.#options;
    this.#options = { ...previous, ...options };
    const session = this.#session;
    if (!session || !ctx || (previous.mode === this.#options.mode && previous.meshSize === this.#options.meshSize))
      return;
    session.mode = this.#createMode(session.source, session.mode.corners());
    this.#preview(ctx);
  }

  runCommand(command: TransformCommand, ctx: ToolContext | null): void {
    const session = this.#session;
    if (!session || !ctx) return;
    switch (command) {
      case 'cancel':
        this.#end(ctx);
        return;
      case 'flip-x':
      case 'flip-y':
        if (session.mode instanceof AffineMode) {
          session.mode.flip(command === 'flip-x' ? 'x' : 'y');
          session.changed = true;
          this.#preview(ctx);
        }
        return;
      case 'commit':
        this.#commit(session, ctx);
        return;
    }
  }

  #commit(session: Session, ctx: ToolContext): void {
    if (session.changed) {
      const { nodeId, source, text, mode } = session;
      const mesh = mode.mesh();
      if (text && mode instanceof AffineMode) {
        void ctx.document.submit(
          ops.updateText({ nodeId, text: { transform: multiplyAffine(mode.matrix(), text.text.transform) } }),
        );
      } else if (text) {
        void ctx.document.submit([ops.rasterizeNode({ nodeId }), ops.warp({ nodeId, source, mesh })]);
      } else {
        void ctx.document.submit(ops.warp({ nodeId, source, mesh }));
      }
    }
    this.#end(ctx);
  }

  getUIState(): TransformUIState {
    return { active: this.#session !== null, message: this.#message };
  }

  drawOverlay(overlay: OverlayBuilder): void {
    this.#session?.mode.draw(overlay);
  }
}
