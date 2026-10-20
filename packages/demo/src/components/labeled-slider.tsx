'use client';
import { Slider } from '@base-ui/react/slider';
import { useState } from 'react';

interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  /** Called on every change while dragging. */
  onChange?: (value: number) => void;
  /** Called once when the drag ends. Use for changes that should become a single undo step. */
  onCommit?: (value: number) => void;
}

/** Labelled slider built on Base UI. */
export function LabeledSlider(props: LabeledSliderProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? props.value;
  return (
    <Slider.Root
      value={value}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      onValueChange={(next) => {
        const v = next as number;
        if (props.onCommit) setDragging(v);
        props.onChange?.(v);
      }}
      onValueCommitted={(next) => {
        setDragging(null);
        props.onCommit?.(next as number);
      }}
      className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 py-1"
    >
      <Slider.Label className="text-xs text-ink-400">{props.label}</Slider.Label>
      <Slider.Control className="flex h-4 items-center">
        <Slider.Track className="h-1 w-full rounded bg-ink-700">
          <Slider.Indicator className="rounded bg-accent" />
          <Slider.Thumb className="size-3 rounded-full bg-ink-200 outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </Slider.Track>
      </Slider.Control>
      <span className="text-right text-xs tabular-nums text-ink-400">{props.format ? props.format(value) : value}</span>
    </Slider.Root>
  );
}
