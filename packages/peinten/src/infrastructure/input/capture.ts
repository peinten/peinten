import type { PointerInput, ToolKeyEvent } from '../../application/tool.ts';
import type { WheelInput } from '../../application/view.ts';
import type { CanvasSize } from '../../application/viewport.ts';
import { modifiersOf, normalizePointer } from './normalize.ts';

/** Where captured input goes: a local view, or a proxy to a view inside a worker. */
export interface InputSink {
  pointer(inputs: PointerInput[]): void;
  key(kind: 'down' | 'up', event: ToolKeyEvent): void;
  wheel(input: WheelInput): void;
  resize(size: CanvasSize): void;
}

/**
 * Listens to a canvas element and forwards normalized input. Resizes are always reported; pointer, key and wheel
 * input only when `input` is enabled. Returns a function that removes every listener.
 */
export function captureInput(canvas: HTMLCanvasElement, sink: InputSink, input: boolean): () => void {
  const dpr = () => globalThis.devicePixelRatio || 1;
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = entry.devicePixelContentBoxSize?.[0];
      const ratio = dpr();
      sink.resize({
        width: box ? box.inlineSize : Math.round(entry.contentRect.width * ratio),
        height: box ? box.blockSize : Math.round(entry.contentRect.height * ratio),
        devicePixelRatio: ratio,
      });
    }
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }
  if (!input) return () => observer.disconnect();

  canvas.style.touchAction = 'none';
  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;

  const onPointer = (kind: PointerInput['kind']) => (e: PointerEvent) => {
    if (kind === 'down') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone (or be synthetic); the stroke still works without capture.
      }
      canvas.focus({ preventScroll: true });
    }
    // Coalesced samples carry the full pen resolution between frames.
    const samples = kind === 'move' && typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = samples.length ? samples : [e];
    sink.pointer(events.map((sample) => normalizePointer(sample, kind, dpr())));
    e.preventDefault();
  };
  const down = onPointer('down');
  const move = onPointer('move');
  const up = onPointer('up');
  const cancel = onPointer('cancel');
  const key = (kind: 'down' | 'up') => (e: KeyboardEvent) => {
    sink.key(kind, { key: e.key, code: e.code, repeat: e.repeat, modifiers: modifiersOf(e) });
    if (e.code === 'Space') e.preventDefault();
  };
  const keydown = key('down');
  const keyup = key('up');
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    sink.wheel({
      screenX: e.offsetX * dpr(),
      screenY: e.offsetY * dpr(),
      deltaX: e.deltaX * scale * dpr(),
      deltaY: e.deltaY * scale * dpr(),
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    });
  };
  const contextMenu = (e: Event) => e.preventDefault();

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('keyup', keyup);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', contextMenu);
  return () => {
    observer.disconnect();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('keydown', keydown);
    canvas.removeEventListener('keyup', keyup);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', contextMenu);
  };
}
