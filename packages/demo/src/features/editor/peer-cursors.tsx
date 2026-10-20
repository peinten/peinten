'use client';
import { documentToScreen, type PaintView } from 'peinten';
import type { RefObject } from 'react';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from './editor-context';

/** Other participants' pointers, positioned over the canvas in CSS pixels. */
export function PeerCursors({ view, canvas }: { view: PaintView; canvas: RefObject<HTMLCanvasElement | null> }) {
  const { document } = useEditor();
  const peers = useSnapshot(document, (s) => s.collab.peers);
  const viewport = useSnapshot(view, (s) => s.viewport);
  const element = canvas.current;
  if (!element) return null;
  // The viewport maps to canvas device pixels; DOM positions are CSS pixels.
  const dpr = globalThis.devicePixelRatio;
  const [a, b, c, d, e, f] = documentToScreen(viewport, {
    width: element.clientWidth * dpr,
    height: element.clientHeight * dpr,
    devicePixelRatio: dpr,
  });
  return (
    <>
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const { x: px, y: py } = peer.cursor;
        const x = (a * px + c * py + e) / dpr;
        const y = (b * px + d * py + f) / dpr;
        return (
          <div
            key={peer.clientId}
            className="pointer-events-none absolute left-0 top-0 flex items-start gap-1"
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
              <path d="M1 1l12 10H7l-3 6z" fill={peer.color} stroke="black" strokeWidth="1" />
            </svg>
            <span className="rounded px-1 text-[10px] font-medium text-ink-950" style={{ background: peer.color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </>
  );
}
