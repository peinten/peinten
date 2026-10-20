'use client';
import type { Exporter } from 'peinten';
import { useState } from 'react';
import { LabeledSlider } from '@/components/labeled-slider';
import { Modal } from '@/components/modal';
import { Segmented } from '@/components/segmented';
import { downloadBlob } from './download';
import { useEditor } from './editor-context';

const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'psd', label: 'PSD' },
] as const;

type Format = (typeof FORMATS)[number]['value'];

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Picks a format and its settings, then downloads the rendered file. */
export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { document } = useEditor();
  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState(92);
  const [background, setBackground] = useState('#ffffff');
  const [busy, setBusy] = useState(false);

  // Loaded on first export, so the editor starts without the exporters and the PSD writer they bring.
  const exporter = async (): Promise<Exporter> => {
    const { jpegExporter, pngExporter, psdExporter } = await import('peinten/exporting');
    if (format === 'jpeg') return jpegExporter({ quality: quality / 100, background: hexToRgb(background) });
    return format === 'png' ? pngExporter() : psdExporter();
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Export">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            downloadBlob(await document.export(await exporter()), `untitled.${format === 'jpeg' ? 'jpg' : format}`);
            onOpenChange(false);
          } catch (error) {
            alert(`Export failed: ${(error as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Segmented value={format} options={FORMATS} onChange={setFormat} />
        {format === 'jpeg' && (
          <>
            <LabeledSlider
              label="Quality"
              value={quality}
              min={1}
              max={100}
              format={(v) => `${v}%`}
              onChange={setQuality}
            />
            <label className="flex items-center justify-between text-xs text-ink-400">
              Background
              <input
                type="color"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                className="h-7 w-10 rounded bg-ink-800"
              />
            </label>
          </>
        )}
        {format === 'psd' && (
          <p className="text-xs text-ink-400">Folders with adjustment layers are merged into one layer.</p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-accent py-1.5 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </form>
    </Modal>
  );
}
