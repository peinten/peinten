'use client';
import type { CreateDocumentOptions, PaintDocument, PaintRuntime, PaintView } from 'peinten';
import { createContext, useContext } from 'react';
import type { Tools } from '@/engine/tools';

export interface EditorContextValue {
  readonly runtime: PaintRuntime<Tools>;
  readonly document: PaintDocument;
  readonly view: PaintView | null;
  readonly setView: (view: PaintView | null) => void;
  /** Replaces the document; rejects and keeps the current one when the new document cannot be created. */
  readonly openDocument: (options: CreateDocumentOptions) => Promise<void>;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);
  if (!value) throw new Error('useEditor must be used inside <Editor>');
  return value;
}
