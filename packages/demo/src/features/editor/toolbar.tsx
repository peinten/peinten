'use client';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import {
  Brush,
  Circle,
  Eraser,
  Hand,
  Lasso,
  Move,
  Pentagon,
  Pipette,
  RotateCw,
  Square,
  Type,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ToolName } from '@/engine/tools';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from './editor-context';

export const TOOL_BUTTONS: readonly {
  id: ToolName;
  label: string;
  shortcut: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { id: 'brush', label: 'Brush', shortcut: 'b', icon: Brush },
  { id: 'eraser', label: 'Eraser', shortcut: 'e', icon: Eraser },
  { id: 'color-picker', label: 'Color picker', shortcut: 'i', icon: Pipette },
  { id: 'select-rect', label: 'Rectangle select', shortcut: 's', icon: Square },
  { id: 'select-ellipse', label: 'Ellipse select', shortcut: 'j', icon: Circle },
  { id: 'select-lasso', label: 'Lasso select', shortcut: 'l', icon: Lasso },
  { id: 'select-polygon', label: 'Polygon select', shortcut: 'p', icon: Pentagon },
  { id: 'select-wand', label: 'Magic wand', shortcut: 'w', icon: Wand2 },
  { id: 'transform', label: 'Transform', shortcut: 't', icon: Move },
  { id: 'text', label: 'Text', shortcut: 'x', icon: Type },
  { id: 'pan', label: 'Pan', shortcut: 'h', icon: Hand },
  { id: 'zoom', label: 'Zoom', shortcut: 'z', icon: ZoomIn },
  { id: 'rotate', label: 'Rotate view', shortcut: 'r', icon: RotateCw },
];

export function Toolbar() {
  const { runtime } = useEditor();
  const active = useSnapshot(runtime, (s) => s.tool.id);
  return (
    <nav className="row-start-2 border-r border-ink-800 bg-ink-900 py-2">
      <ToggleGroup
        value={[active]}
        onValueChange={(value) => {
          const next = value[0] as ToolName | undefined;
          if (next) void runtime.setTool(next);
        }}
        className="flex flex-col items-center gap-1"
        orientation="vertical"
      >
        {TOOL_BUTTONS.map(({ id, label, shortcut, icon: Icon }) => (
          <Toggle
            key={id}
            value={id}
            aria-label={label}
            title={`${label} (${shortcut.toUpperCase()})`}
            className="flex size-9 items-center justify-center rounded-md text-ink-400 hover:bg-ink-800 hover:text-ink-200 data-[pressed]:bg-accent/20 data-[pressed]:text-accent"
          >
            <Icon className="size-4" />
          </Toggle>
        ))}
      </ToggleGroup>
    </nav>
  );
}
