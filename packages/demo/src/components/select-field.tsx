'use client';
import { Select } from '@base-ui/react/select';
import { ChevronDown } from 'lucide-react';

/** Compact single-choice dropdown built on Base UI. */
export function SelectField<V extends string>({
  value,
  items,
  onChange,
}: {
  value: V;
  items: readonly { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  return (
    <Select.Root items={items} value={value} onValueChange={(next) => next && onChange(next as V)}>
      <Select.Trigger className="flex h-7 w-full items-center justify-between rounded bg-ink-800 px-2 text-xs text-ink-200">
        <Select.Value />
        <Select.Icon>
          <ChevronDown className="size-3" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} className="z-50">
          <Select.Popup className="max-h-80 overflow-y-auto rounded-md border border-ink-700 bg-ink-850 py-1 shadow-xl">
            <Select.List>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  className="cursor-default px-3 py-1 text-xs text-ink-200 outline-none data-[highlighted]:bg-accent/20"
                >
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
