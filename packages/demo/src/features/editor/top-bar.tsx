'use client';
import { importImage, ops } from 'peinten';
import { useRef, useState } from 'react';
import { DropdownMenu } from '@/components/dropdown-menu';
import { Modal } from '@/components/modal';
import { useSnapshot } from '@/hooks/snapshots';
import { BlurDialog } from './blur-dialog';
import { CollabControls } from './collab-controls';
import { downloadBlob } from './download';
import { useEditor } from './editor-context';
import { ExportDialog } from './export-dialog';
import { placementAbove } from './panels/layers-panel';

const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function TopBar() {
  const { document, view, openDocument } = useEditor();
  const history = useSnapshot(document, (s) => s.history);
  const quickMask = useSnapshot(document, (s) => s.quickMask);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [blurOpen, setBlurOpen] = useState(false);
  const [size, setSize] = useState({ width: 1600, height: 1200 });

  const open = (options: Parameters<typeof openDocument>[0]) =>
    openDocument(options).catch((error: unknown) => alert(`Could not open the document: ${(error as Error).message}`));

  const importFile = async (file: File) => {
    const drafts = await importImage(file, { ...placementAbove(document.getSnapshot()), name: file.name });
    await document.dispatch(drafts);
    await document.setActiveNode(drafts[0].nodeId);
  };

  return (
    <header className="col-span-3 flex items-center gap-1 border-b border-ink-800 bg-ink-900 px-2">
      <span className="mr-3 pl-1 font-semibold tracking-tight text-ink-200">peinten</span>
      <DropdownMenu
        label="File"
        entries={[
          { label: 'New…', onSelect: () => setNewOpen(true) },
          { label: 'Open…', onSelect: () => fileInput.current?.click() },
          {
            label: 'Save',
            onSelect: async () =>
              downloadBlob(new Blob([(await document.serialize()) as Uint8Array<ArrayBuffer>]), 'untitled.peinten'),
          },
          null,
          { label: 'Import image…', onSelect: () => imageInput.current?.click() },
          { label: 'Export…', onSelect: () => setExportOpen(true) },
        ]}
      />
      <DropdownMenu
        label="Edit"
        entries={[
          { label: 'Undo', shortcut: `${MOD}Z`, disabled: !history.canUndo, onSelect: () => void document.undo() },
          { label: 'Redo', shortcut: `${MOD}⇧Z`, disabled: !history.canRedo, onSelect: () => void document.redo() },
          null,
          {
            label: 'Clear layer',
            shortcut: 'Del',
            onSelect: () => {
              const active = document.getSnapshot().activeNodeId;
              if (active) void document.dispatch(ops.clear({ nodeId: active }));
            },
          },
        ]}
      />
      <DropdownMenu
        label="Select"
        entries={[
          { label: 'Select all', shortcut: `${MOD}A`, onSelect: () => void document.dispatch(ops.selectAll()) },
          { label: 'Deselect', shortcut: `${MOD}D`, onSelect: () => void document.dispatch(ops.deselect()) },
          {
            label: 'Invert selection',
            shortcut: `${MOD}⇧I`,
            onSelect: () => void document.dispatch(ops.invertSelection()),
          },
          null,
          {
            label: quickMask ? 'Exit quick mask' : 'Quick mask',
            shortcut: 'Q',
            onSelect: () => void document.setQuickMask(!quickMask),
          },
        ]}
      />
      <DropdownMenu label="Filter" entries={[{ label: 'Gaussian blur…', onSelect: () => setBlurOpen(true) }]} />
      <DropdownMenu
        label="View"
        entries={[
          {
            label: 'Actual size',
            shortcut: '1',
            onSelect: () => {
              const { width, height } = document.getSnapshot();
              void view?.setViewport({ centerX: width / 2, centerY: height / 2, zoom: 1, rotation: 0, flipX: false });
            },
          },
          {
            label: 'Flip horizontally',
            shortcut: 'M',
            onSelect: () => view && void view.setViewport({ flipX: !view.getSnapshot().viewport.flipX }),
          },
        ]}
      />
      <CollabControls />
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".peinten"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void open({ from: new Uint8Array(await file.arrayBuffer()) });
        }}
      />
      <BlurDialog open={blurOpen} onOpenChange={setBlurOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <Modal open={newOpen} onOpenChange={setNewOpen} title="New document">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setNewOpen(false);
            void open(size);
          }}
        >
          {(['width', 'height'] as const).map((key) => (
            <label key={key} className="flex items-center justify-between gap-3 text-xs capitalize text-ink-400">
              {key}
              <input
                type="number"
                min={1}
                max={8192}
                value={size[key]}
                onChange={(e) => setSize((s) => ({ ...s, [key]: Number(e.target.value) }))}
                className="w-28 rounded bg-ink-800 px-2 py-1 text-right text-ink-200"
              />
            </label>
          ))}
          <button type="submit" className="w-full rounded bg-accent py-1.5 font-medium text-white">
            Create
          </button>
        </form>
      </Modal>
    </header>
  );
}
