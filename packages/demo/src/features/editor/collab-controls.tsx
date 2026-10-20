'use client';
import { broadcastChannelTransport } from 'peinten/collab';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from './editor-context';

const ROOM = 'peinten-demo';
const NAMES = ['Otter', 'Heron', 'Lynx', 'Moth', 'Finch', 'Newt', 'Orca', 'Wren'];

/** Picked once per tab so other tabs can tell participants apart. */
const self = {
  name: NAMES[Math.floor(Math.random() * NAMES.length)]!,
  color: `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`,
};

const STATUS_COLOR = { offline: 'bg-ink-600', connecting: 'bg-amber-400', online: 'bg-emerald-400' } as const;

/** Joins the tab-to-tab room and shows who else is in it. */
export function CollabControls() {
  const { runtime, document } = useEditor();
  const collab = useSnapshot(document, (s) => s.collab);
  // Derived from the document, so opening another document shows it as not joined.
  const joined = collab.status !== 'offline';

  const toggle = async () => {
    if (joined) return document.collab.disconnect();
    await document.collab.connect(broadcastChannelTransport({ room: ROOM, registry: runtime.registry }));
    await document.collab.setPresence(self);
  };

  return (
    <div className="ml-auto flex items-center gap-2">
      {collab.peers.map((peer) => (
        <span
          key={peer.clientId}
          title={peer.name}
          className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-ink-950"
          style={{ background: peer.color }}
        >
          {peer.name.slice(0, 2)}
        </span>
      ))}
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-2 rounded bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700"
        title={joined ? `Joined as ${self.name}` : 'Edit together with other tabs of this demo'}
      >
        <span className={`size-2 rounded-full ${STATUS_COLOR[collab.status]}`} />
        {joined ? 'Leave' : 'Collaborate'}
      </button>
    </div>
  );
}
