import type { Metadata } from 'next';
import { Editor } from '@/features/editor/editor';

export const metadata: Metadata = { title: 'Demo · peinten' };

export default function Page() {
  // The editor fills the viewport and handles its own scrolling.
  return (
    <div className="h-dvh overflow-hidden">
      <Editor />
    </div>
  );
}
