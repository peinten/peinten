'use client';
import { Menu } from '@base-ui/react/menu';

export interface MenuEntry {
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

/** Menu bar entry: a trigger button with a popup list of actions. `null` entries render separators. */
export function DropdownMenu({ label, entries }: { label: string; entries: readonly (MenuEntry | null)[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="h-7 rounded px-2.5 text-ink-200 hover:bg-ink-800 data-[popup-open]:bg-ink-800">
        {label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-50 outline-none">
          <Menu.Popup className="min-w-52 rounded-md border border-ink-700 bg-ink-850 py-1 shadow-xl outline-none">
            {entries.map((entry, i) =>
              entry ? (
                <Menu.Item
                  key={entry.label}
                  disabled={entry.disabled}
                  onClick={entry.onSelect}
                  className="flex cursor-default items-center justify-between gap-6 px-3 py-1.5 text-xs text-ink-200 outline-none data-[disabled]:text-ink-600 data-[highlighted]:bg-accent/20"
                >
                  {entry.label}
                  {entry.shortcut && <span className="text-ink-400">{entry.shortcut}</span>}
                </Menu.Item>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
                <Menu.Separator key={`separator-${i}`} className="my-1 h-px bg-ink-700" />
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
