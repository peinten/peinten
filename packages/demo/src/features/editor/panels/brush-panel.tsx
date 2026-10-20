'use client';
import { Eraser, FileUp } from 'lucide-react';
import { brushSize, parseMyb, presets } from 'peinten';
import { useRef, useState } from 'react';
import { IconButton } from '@/components/icon-button';
import { LabeledSlider } from '@/components/labeled-slider';
import { Panel } from '@/components/panel';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';
import { BrushPreview } from './brush-preview';

export function BrushPanel() {
  const { runtime } = useEditor();
  const resources = useSnapshot(runtime, (s) => s.resources);
  const [custom, setCustom] = useState<typeof presets>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const brushes = [...presets, ...custom];
  const size = resources.size ?? brushSize(resources.brush);

  const loadMyb = async (file: File) => {
    const { brush, ignored } = parseMyb(await file.text(), file.name.replace(/\.myb$/, ''));
    if (ignored.length) console.info('Ignored brush settings:', ignored);
    setCustom((list) => [...list.filter((b) => b.name !== brush.name), brush]);
    void runtime.setResources({ brush, size: null, opacity: null });
  };

  return (
    <Panel
      title="Brush"
      actions={
        <>
          <IconButton
            label="Eraser mode (E on pen)"
            active={resources.eraser}
            onClick={() => void runtime.setResources({ eraser: !resources.eraser })}
          >
            <Eraser className="size-3.5" />
          </IconButton>
          <IconButton label="Load .myb brush" onClick={() => fileInput.current?.click()}>
            <FileUp className="size-3.5" />
          </IconButton>
          <input
            ref={fileInput}
            type="file"
            accept=".myb,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadMyb(file);
              e.target.value = '';
            }}
          />
        </>
      }
    >
      <BrushPreview />
      <div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
        {brushes.map((brush) => (
          <button
            type="button"
            key={brush.name}
            onClick={() => void runtime.setResources({ brush, size: null, opacity: null })}
            className={`truncate rounded px-2 py-1 text-left text-xs ${brush.name === resources.brush.name ? 'bg-accent/20 text-accent' : 'text-ink-200 hover:bg-ink-800'}`}
          >
            {brush.name ?? 'Brush'}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <LabeledSlider
          label="Size"
          value={Math.round(size)}
          min={1}
          max={400}
          format={(v) => `${v}px`}
          onChange={(value) => void runtime.setResources({ size: value })}
        />
        <LabeledSlider
          label="Opacity"
          value={Math.round((resources.opacity ?? 1) * 100)}
          min={1}
          max={100}
          format={(v) => `${v}%`}
          onChange={(value) => void runtime.setResources({ opacity: value / 100 })}
        />
      </div>
    </Panel>
  );
}
