'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';

export interface AgentDocument {
  id: string;
  title: string;
  content: string;
  /** conversation or issue this document came from */
  source?: string;
  createdAt: number;
  updatedAt: number;
}

const KEY = `linear-lab:documents:${currentUserId()}`;
const MAX_DOCS = 100;

const persist = (documents: AgentDocument[]) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(documents.slice(0, MAX_DOCS)));
  } catch {
    /* quota */
  }
};

interface DocumentsState {
  documents: AgentDocument[];
  hydrated: boolean;
  hydrate: () => void;
  create: (input: { title: string; content: string; source?: string }) => AgentDocument | null;
  update: (id: string, patch: { title?: string; content?: string }) => void;
  remove: (id: string) => void;
}

export const useDocuments = create<DocumentsState>((set, get) => ({
  documents: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    let documents: AgentDocument[] = [];
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AgentDocument[];
        if (Array.isArray(parsed)) {
          documents = parsed.filter(
            (doc) => doc && typeof doc.id === 'string' && typeof doc.title === 'string' && typeof doc.content === 'string',
          );
        }
      }
    } catch {
      /* malformed */
    }
    set({ documents, hydrated: true });
  },

  create: ({ title, content, source }) => {
    const trimmed = title.trim().slice(0, 120);
    if (!trimmed) return null;
    const doc: AgentDocument = {
      id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      title: trimmed,
      content,
      source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => {
      const documents = [doc, ...state.documents].slice(0, MAX_DOCS);
      persist(documents);
      return { documents };
    });
    return doc;
  },

  update: (id, patch) => {
    set((state) => {
      const documents = state.documents.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              ...(patch.title !== undefined ? { title: patch.title.slice(0, 120) } : {}),
              ...(patch.content !== undefined ? { content: patch.content } : {}),
              updatedAt: Date.now(),
            }
          : doc,
      );
      persist(documents);
      return { documents };
    });
  },

  remove: (id) => {
    set((state) => {
      const documents = state.documents.filter((doc) => doc.id !== id);
      persist(documents);
      return { documents };
    });
  },
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_DOCUMENTS__?: typeof useDocuments }).__AETHER_DOCUMENTS__ = useDocuments;
}
