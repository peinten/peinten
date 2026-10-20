'use client';
import { useEffect, useRef, useState } from 'react';
import { type HsvColor, HsvColorPicker } from 'react-colorful';
import { Panel } from '@/components/panel';
import { useSnapshot } from '@/hooks/snapshots';
import { useEditor } from '../editor-context';

type Rgb = readonly [number, number, number];

function hsvToRgb({ h, s, v }: HsvColor): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v / 100) * (1 - (s / 100) * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function rgbToHsv([r, g, b]: Rgb): HsvColor {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

const toHex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export function ColorPanel() {
  const { runtime } = useEditor();
  const color = useSnapshot(runtime, (s) => s.resources.color);
  // Hue is kept locally so grays (where hue is undefined) do not reset the hue slider.
  const [hsv, setHsv] = useState(() => rgbToHsv(color));
  const sent = useRef<Rgb>(color);

  useEffect(() => {
    if (color !== sent.current) setHsv(rgbToHsv(color));
  }, [color]);

  return (
    <Panel title="Color" actions={<span className="font-mono normal-case text-ink-400">{toHex(color)}</span>}>
      <HsvColorPicker
        style={{ width: '100%', height: 180 }}
        color={hsv}
        onChange={(next) => {
          setHsv(next);
          const rgb = hsvToRgb(next);
          sent.current = rgb;
          void runtime.setResources({ color: rgb });
        }}
      />
    </Panel>
  );
}
