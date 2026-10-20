'use client';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';

/** Single-choice segmented control. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(next) => next[0] && onChange(next[0] as V)}
      className="flex rounded bg-ink-800 p-0.5"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className="rounded px-2 py-0.5 text-xs text-ink-400 hover:text-ink-200 data-[pressed]:bg-ink-600 data-[pressed]:text-ink-200"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
