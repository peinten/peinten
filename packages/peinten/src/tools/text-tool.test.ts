import { describe, expect, it } from 'vitest';
import { newLocalDocument } from '../../test/fakes.ts';
import type { ToolContext, ToolPointerEvent } from '../application/tool.ts';
import { TextTool } from './text-tool.ts';

function pointer(x: number, y: number): ToolPointerEvent {
  return { x, y, screenX: x, screenY: y, button: 0, pointerId: 1 } as ToolPointerEvent;
}

function setup() {
  const { document, scheduler } = newLocalDocument();
  const ctx = {
    document: document.toolDocument,
    resources: { get: () => ({ color: [1, 0, 0] }) },
    requestOverlay: () => {},
  } as unknown as ToolContext;
  const settle = async () => {
    // Lets the queued submit and the follow-up activation run, then publishes the snapshot.
    await document.dispatch([]);
    scheduler.flush();
  };
  return { document, ctx, settle, tool: new TextTool() };
}

describe('TextTool', () => {
  it('places point text above the active layer on click and selects it', async () => {
    const { document, ctx, settle, tool } = setup();
    tool.onPointerDown(pointer(40, 50), ctx);
    tool.onPointerUp(pointer(40, 50), ctx);
    await settle();
    const snapshot = document.getSnapshot();
    expect(snapshot.rootIds).toHaveLength(2);
    const text = snapshot.nodes[snapshot.rootIds[1]!]!;
    expect(snapshot.activeNodeId).toBe(text.id);
    expect(text.text?.frame).toEqual({ kind: 'point' });
    expect(text.text?.transform).toEqual([1, 0, 0, 1, 40, 50]);
    expect(text.text?.runs[0]?.style.color).toEqual([1, 0, 0, 1]);
  });

  it('creates area text from a drag, anchored at the right edge in vertical writing', async () => {
    const { document, ctx, settle, tool } = setup();
    tool.setOptions({ writingMode: 'vertical-rl' });
    tool.onPointerDown(pointer(80, 10), ctx);
    tool.onPointerMove(pointer(20, 70), ctx);
    tool.onPointerUp(pointer(20, 70), ctx);
    await settle();
    const snapshot = document.getSnapshot();
    const text = snapshot.nodes[snapshot.activeNodeId!]!.text!;
    expect(text.frame).toEqual({ kind: 'area', width: 60, height: 60 });
    expect(text.transform).toEqual([1, 0, 0, 1, 80, 10]);
    expect(text.writingMode).toBe('vertical-rl');
  });
});
