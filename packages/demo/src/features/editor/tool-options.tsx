'use client';
import type { SelectionMode } from 'peinten';
import type { TransformModeName } from 'peinten/tools';
import { LabeledSlider } from '@/components/labeled-slider';
import { Segmented } from '@/components/segmented';
import { SelectField } from '@/components/select-field';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from './editor-context';
import { FONT_FAMILIES, WRITING_MODES } from './fonts';

const MODES: readonly { value: SelectionMode; label: string }[] = [
  { value: 'replace', label: 'Replace' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

const TRANSFORM_MODES: readonly { value: TransformModeName; label: string }[] = [
  { value: 'affine', label: 'Affine' },
  { value: 'perspective', label: 'Perspective' },
  { value: 'mesh', label: 'Mesh' },
];

const buttonClass = 'rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-200 hover:bg-ink-700 disabled:text-ink-600';

/** Options of the active tool, shown above the canvas. */
export function ToolOptions() {
  const { runtime } = useEditor();
  const tool = useSnapshot(runtime, (s) => s.tool);

  let content: React.ReactNode = null;
  switch (tool.id) {
    case 'brush':
    case 'eraser':
      if (tool.uiState && !tool.uiState.canPaint)
        content = (
          <span className="text-amber-300">The active layer cannot be painted. Pick an unlocked paint layer.</span>
        );
      break;
    case 'select-rect':
    case 'select-ellipse':
    case 'select-lasso':
    case 'select-polygon':
    case 'select-wand':
      content = (
        <>
          <Segmented
            value={tool.options.mode}
            options={MODES}
            onChange={(mode) => void runtime.setToolOptions(tool.id, { mode })}
          />
          <label className="flex items-center gap-1.5 text-xs text-ink-400">
            <input
              type="checkbox"
              checked={tool.options.antialias}
              onChange={(e) => void runtime.setToolOptions(tool.id, { antialias: e.target.checked })}
            />
            Anti-alias
          </label>
          {tool.id === 'select-wand' && (
            <>
              <div className="w-56">
                <LabeledSlider
                  label="Tolerance"
                  value={Math.round(tool.options.tolerance * 100)}
                  min={0}
                  max={100}
                  format={(v) => `${v}%`}
                  onChange={(v) => void runtime.setToolOptions('select-wand', { tolerance: v / 100 })}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink-400">
                <input
                  type="checkbox"
                  checked={tool.options.contiguous}
                  onChange={(e) => void runtime.setToolOptions('select-wand', { contiguous: e.target.checked })}
                />
                Contiguous
              </label>
              {tool.uiState && !tool.uiState.canSample && (
                <span className="text-amber-300">The magic wand samples paint layers only.</span>
              )}
            </>
          )}
          <span className="text-ink-600">Shift add · Alt subtract · Shift+Alt intersect</span>
        </>
      );
      break;
    case 'text':
      content = (
        <>
          <Segmented
            value={tool.options.writingMode}
            options={WRITING_MODES}
            onChange={(writingMode) => void runtime.setToolOptions('text', { writingMode })}
          />
          <div className="w-36 shrink-0">
            <SelectField
              value={tool.options.fontFamily}
              items={FONT_FAMILIES}
              onChange={(fontFamily) => void runtime.setToolOptions('text', { fontFamily })}
            />
          </div>
          <div className="w-56 shrink-0">
            <LabeledSlider
              label="Size"
              value={tool.options.fontSize}
              min={8}
              max={200}
              format={(v) => `${v}px`}
              onChange={(fontSize) => void runtime.setToolOptions('text', { fontSize })}
            />
          </div>
          <span className="whitespace-nowrap text-xs text-ink-400">
            Click for point text, drag for area text, click text to select it.
          </span>
        </>
      );
      break;
    case 'transform':
      content = (
        <>
          <Segmented
            value={tool.options.mode}
            options={TRANSFORM_MODES}
            onChange={(mode) => void runtime.setToolOptions('transform', { mode })}
          />
          {tool.options.mode === 'mesh' && (
            <div className="w-44 shrink-0">
              <LabeledSlider
                label="Grid"
                value={tool.options.meshSize}
                min={2}
                max={8}
                onChange={(meshSize) => void runtime.setToolOptions('transform', { meshSize })}
              />
            </div>
          )}
          {tool.options.mode === 'affine' && (
            <>
              <button
                type="button"
                className={buttonClass}
                disabled={!tool.uiState?.active}
                onClick={() => void runtime.runToolCommand('transform', 'flip-x')}
              >
                Flip H
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!tool.uiState?.active}
                onClick={() => void runtime.runToolCommand('transform', 'flip-y')}
              >
                Flip V
              </button>
            </>
          )}
          <button
            type="button"
            className={`${buttonClass} bg-accent/80 text-white`}
            disabled={!tool.uiState?.active}
            onClick={() => void runtime.runToolCommand('transform', 'commit')}
          >
            Apply (Enter)
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={!tool.uiState?.active}
            onClick={() => void runtime.runToolCommand('transform', 'cancel')}
          >
            Cancel (Esc)
          </button>
          {tool.uiState?.message && <span className="text-amber-300">{tool.uiState.message}</span>}
        </>
      );
      break;
  }
  if (!content) return null;
  return (
    <div className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-3 rounded-md bg-ink-900/90 px-3 py-1.5 shadow">
      {content}
    </div>
  );
}
