'use client';
import { applyStyle, ops, plainText, replaceText, type TextLayerData, type TextStyle } from 'peinten';
import { useEffect, useRef, useState } from 'react';
import { LabeledSlider } from '@/components/labeled-slider';
import { Panel } from '@/components/panel';
import { Segmented } from '@/components/segmented';
import { SelectField } from '@/components/select-field';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';
import { FONT_FAMILIES, WRITING_MODES } from '../fonts';

const ALIGNS = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
] as const;

const toggleClass =
  'rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-400 hover:text-ink-200 data-[on=true]:bg-ink-600 data-[on=true]:text-ink-200';

function toHex(color: TextStyle['color']): string {
  return `#${color
    .slice(0, 3)
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function fromHex(hex: string): TextStyle['color'] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/** The style at a UTF-16 offset, used to show the current formatting of the selection. */
function styleAt(text: TextLayerData, offset: number): TextStyle | undefined {
  let position = 0;
  for (const run of text.runs) {
    position += run.text.length;
    if (offset < position) return run.style;
  }
  return text.runs.at(-1)?.style;
}

/** Index range where `before` and `after` differ, as [start, endBefore, endAfter]. */
function changedRange(before: string, after: string): [number, number, number] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  return [start, before.length - tail, after.length - tail];
}

/** Edits the text and per-range formatting of the active text layer. */
export function TextPanel() {
  const { document } = useEditor();
  const active = useSnapshot(document, (s) => (s.activeNodeId ? s.nodes[s.activeNodeId] : undefined));
  if (active?.kind !== 'text' || !active.text) return null;
  return <TextEditor key={active.id} nodeId={active.id} text={active.text} />;
}

function TextEditor({ nodeId, text }: { nodeId: string; text: TextLayerData }) {
  const { document } = useEditor();
  const area = useRef<HTMLTextAreaElement>(null);
  // Runs including local edits whose snapshot has not arrived yet, so fast typing diffs against the right base.
  const runs = useRef(text.runs);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);

  // Adopt outside changes such as undo, but not while typing: echoes of our own edits would move the caret.
  useEffect(() => {
    if (!area.current || globalThis.document.activeElement === area.current) return;
    runs.current = text.runs;
    area.current.value = plainText(text.runs);
  }, [text.runs]);

  const update = (patch: Partial<TextLayerData>) => void document.dispatch(ops.updateText({ nodeId, text: patch }));

  const setRuns = (next: TextLayerData['runs']) => {
    runs.current = next;
    update({ runs: next });
  };

  /** Applies to the selected characters, or to all text when nothing is selected. */
  const style = (patch: Partial<TextStyle>) => {
    const el = area.current;
    if (!el) return;
    // Read the range from the element: it survives the blur caused by clicking a control.
    const whole = el.selectionStart === el.selectionEnd;
    const start = whole ? 0 : el.selectionStart;
    const end = whole ? plainText(runs.current).length : el.selectionEnd;
    setRuns(applyStyle(runs.current, start, end, patch));
  };

  const current = styleAt({ ...text, runs: runs.current }, selection[0]);
  const trackSelection = () => {
    const el = area.current;
    if (el) setSelection([el.selectionStart, el.selectionEnd]);
  };

  return (
    <Panel title="Text">
      <div className="space-y-2">
        <textarea
          ref={area}
          defaultValue={plainText(text.runs)}
          rows={4}
          className="w-full resize-y rounded bg-ink-800 p-2 text-sm text-ink-200 outline-none focus:ring-1 focus:ring-accent"
          onChange={(e) => {
            const before = plainText(runs.current);
            const [start, endBefore, endAfter] = changedRange(before, e.target.value);
            setRuns(replaceText(runs.current, start, endBefore, e.target.value.slice(start, endAfter)));
            trackSelection();
          }}
          onSelect={trackSelection}
          onKeyUp={trackSelection}
          onBlur={() => {
            // Snapshots that arrived while typing were skipped; catch up now.
            runs.current = text.runs;
          }}
        />
        <p className="text-xs text-ink-500">Formatting applies to the selected characters, or to all text.</p>
        {current && (
          <>
            <SelectField
              value={current.fontFamily}
              items={FONT_FAMILIES}
              onChange={(fontFamily) => style({ fontFamily })}
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={4}
                max={400}
                value={current.fontSize}
                aria-label="Font size"
                className="h-7 w-16 rounded bg-ink-800 px-2 text-xs text-ink-200"
                onChange={(e) => {
                  const fontSize = Number(e.target.value);
                  if (fontSize >= 4) style({ fontSize });
                }}
              />
              <button
                type="button"
                className={`${toggleClass} font-bold`}
                data-on={current.fontWeight >= 700}
                onClick={() => style({ fontWeight: current.fontWeight >= 700 ? 400 : 700 })}
              >
                B
              </button>
              <button
                type="button"
                className={`${toggleClass} italic`}
                data-on={current.fontStyle === 'italic'}
                onClick={() => style({ fontStyle: current.fontStyle === 'italic' ? 'normal' : 'italic' })}
              >
                I
              </button>
              <input
                type="color"
                value={toHex(current.color)}
                aria-label="Text color"
                className="h-7 w-10 cursor-pointer rounded bg-ink-800"
                onChange={(e) => style({ color: fromHex(e.target.value) })}
              />
            </div>
          </>
        )}
        <Segmented
          value={text.writingMode}
          options={WRITING_MODES}
          onChange={(writingMode) => update({ writingMode })}
        />
        <Segmented
          value={text.paragraph.align}
          options={ALIGNS}
          onChange={(align) => update({ paragraph: { ...text.paragraph, align } })}
        />
        <LabeledSlider
          label="Line height"
          value={Math.round(text.paragraph.lineHeight * 100)}
          min={80}
          max={300}
          step={5}
          format={(v) => `${v}%`}
          onCommit={(v) => update({ paragraph: { ...text.paragraph, lineHeight: v / 100 } })}
        />
      </div>
    </Panel>
  );
}
