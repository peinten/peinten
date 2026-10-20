import { describe, expect, expectTypeOf, it } from 'vitest';
import { newLocalDocument } from '../../../test/fakes.ts';
import type { ToolContext, ToolOptions, ToolPointerEvent } from '../../application/tool.ts';
import { selectionCoverage } from '../../domain/document/selection.ts';
import { ops } from '../../domain/ops/factories.ts';
import type { SelectionToolOptions } from './selection-mode.ts';
import { ShapeSelectTool } from './shape-select-tool.ts';
import { WandSelectTool } from './wand-select-tool.ts';

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

function pointer(x: number, y: number): ToolPointerEvent {
  return { x, y, screenX: x, screenY: y, button: 0, pointerId: 1, modifiers: NO_MODIFIERS } as ToolPointerEvent;
}

async function setup() {
  const { document } = newLocalDocument();
  const offsets: unknown[] = [];
  const ctx = {
    document: document.toolDocument,
    preview: { setSelectionOffset: (offset: unknown) => offsets.push(offset) },
    requestOverlay: () => {},
    notifyUIState: () => {},
  } as unknown as ToolContext;
  await document.dispatch(
    ops.selectShape({ mode: 'replace', shape: { kind: 'rect', x: 10, y: 10, width: 20, height: 20 } }),
  );
  // Lets the submit started by the tool finish before the state is inspected.
  const settle = () => document.dispatch([]);
  return { document, ctx, offsets, settle };
}

describe('moving the selection', () => {
  it('moves the outline when a drag starts inside the selection', async () => {
    const { document, ctx, offsets, settle } = await setup();
    const tool = new ShapeSelectTool('rect');
    tool.onPointerDown(pointer(15, 15), ctx);
    tool.onPointerMove(pointer(30.4, 20), ctx);
    tool.onPointerUp(pointer(40.6, 25), ctx);
    await settle();
    const mask = document.state.selections.get('me')!;
    expect(selectionCoverage(mask, 36, 25)).toBe(1);
    expect(selectionCoverage(mask, 12, 12)).toBe(0);
    expect(offsets).toEqual([{ x: 15, y: 5 }, null]);
  });

  it('leaves clicks inside the selection to the tool', async () => {
    const { document, ctx, settle } = await setup();
    const rect = new ShapeSelectTool('rect');
    rect.onPointerDown(pointer(15, 15), ctx);
    rect.onPointerUp(pointer(15, 15), ctx);
    await settle();
    expect(document.state.selections.has('me')).toBe(false);
  });

  it('starts a new selection when the press is outside or a modifier asks to combine', async () => {
    const { document, ctx, settle } = await setup();
    const rect = new ShapeSelectTool('rect');
    const shifted = { ...pointer(15, 15), modifiers: { ...NO_MODIFIERS, shift: true } };
    rect.onPointerDown(shifted, ctx);
    rect.onPointerMove({ ...shifted, x: 50, y: 50, screenX: 50, screenY: 50 }, ctx);
    rect.onPointerUp({ ...shifted, x: 50, y: 50, screenX: 50, screenY: 50 }, ctx);
    await settle();
    const mask = document.state.selections.get('me')!;
    expect(selectionCoverage(mask, 12, 12)).toBe(1);
    expect(selectionCoverage(mask, 45, 45)).toBe(1);
  });

  it('lets the wand sample on a click inside the selection', async () => {
    const { document, ctx, settle } = await setup();
    const wand = new WandSelectTool();
    wand.onPointerDown(pointer(15, 15), ctx);
    wand.onPointerUp(pointer(15, 15), ctx);
    await settle();
    // The empty layer is uniform, so the wand selects the whole document.
    expect(selectionCoverage(document.state.selections.get('me')!, 100, 100)).toBe(1);
  });
});

describe('rectangle selection', () => {
  it('snaps the dragged rectangle to whole pixels', async () => {
    const { document, ctx, settle } = await setup();
    const rect = new ShapeSelectTool('rect');
    rect.onPointerDown(pointer(60.3, 60.6), ctx);
    rect.onPointerMove(pointer(70.7, 65.2), ctx);
    rect.onPointerUp(pointer(70.7, 65.2), ctx);
    await settle();
    const mask = document.state.selections.get('me')!;
    // Rounded to x 60..71 and y 61..65: no partially covered edge pixels.
    expect(selectionCoverage(mask, 60, 61)).toBe(1);
    expect(selectionCoverage(mask, 70, 64)).toBe(1);
    expect(selectionCoverage(mask, 71, 62)).toBe(0);
    expect(selectionCoverage(mask, 65, 60)).toBe(0);
    expect(selectionCoverage(mask, 65, 65)).toBe(0);
  });
});

describe('ShapeSelectTool types', () => {
  it('infers the tool id from the shape', () => {
    const tools = [new ShapeSelectTool('rect'), new ShapeSelectTool('ellipse')] as const;
    expectTypeOf(tools[0].id).toEqualTypeOf<'select-rect'>();
    expectTypeOf(tools[1].id).toEqualTypeOf<'select-ellipse'>();
    expectTypeOf<ToolOptions<typeof tools, 'select-rect'>>().toEqualTypeOf<SelectionToolOptions>();
    // The explicit form keeps working.
    expectTypeOf(new ShapeSelectTool<'select-ellipse'>('ellipse').id).toEqualTypeOf<'select-ellipse'>();
  });
});
