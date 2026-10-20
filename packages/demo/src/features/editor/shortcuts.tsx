'use client';
import { brushSize, ops } from 'peinten';
import { useEffect } from 'react';
import { tinykeys } from 'tinykeys';
import { useEditor } from './editor-context';
import { TOOL_BUTTONS } from './toolbar';

const isTyping = (event: KeyboardEvent) =>
  event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

/** Every keyboard shortcut of the demo in one keymap. The library itself binds no application shortcuts. */
export function Shortcuts() {
  const { runtime, document, view } = useEditor();

  useEffect(() => {
    const guard = (action: () => void) => (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      event.preventDefault();
      action();
    };
    const scaleBrush = (factor: number) => {
      const { resources } = runtime.getSnapshot();
      const size = resources.size ?? brushSize(resources.brush);
      void runtime.setResources({ size: Math.min(400, Math.max(1, Math.round(size * factor))) });
    };
    const bindings: Record<string, (event: KeyboardEvent) => void> = {
      '$mod+z': guard(() => void document.undo()),
      '$mod+Shift+z': guard(() => void document.redo()),
      '$mod+y': guard(() => void document.redo()),
      '[': guard(() => scaleBrush(1 / 1.15)),
      ']': guard(() => scaleBrush(1.15)),
      Delete: guard(() => {
        const active = document.getSnapshot().activeNodeId;
        if (active) void document.dispatch(ops.clear({ nodeId: active }));
      }),
      m: guard(() => view && void view.setViewport({ flipX: !view.getSnapshot().viewport.flipX })),
      '$mod+a': guard(() => void document.dispatch(ops.selectAll())),
      '$mod+d': guard(() => void document.dispatch(ops.deselect())),
      '$mod+Shift+i': guard(() => void document.dispatch(ops.invertSelection())),
      q: guard(() => void document.setQuickMask(!document.getSnapshot().quickMask)),
    };
    for (const { id, shortcut } of TOOL_BUTTONS) bindings[shortcut] = guard(() => void runtime.setTool(id));
    return tinykeys(window, bindings);
  }, [runtime, document, view]);

  return null;
}
