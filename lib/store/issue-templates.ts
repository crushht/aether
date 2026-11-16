'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { useData } from './data';
import type { Issue, Priority, StatusKey } from '@/lib/types';
import { readStorage, writeStorage } from './storage';

export interface IssueTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  status: StatusKey;
  priority: Priority;
  labelIds: string[];
  projectId: string | null;
  estimate: number | null;
  createdAt: number;
}

const KEY = `linear-lab:issue-templates:${currentUserId()}`;
const MAX_TEMPLATES = 40;

const persist = (templates: IssueTemplate[]) => writeStorage(KEY, templates.slice(0, MAX_TEMPLATES));

interface TemplateState {
  templates: IssueTemplate[];
  hydrated: boolean;
  hydrate: () => void;
  saveFromIssue: (issue: Issue, name?: string) => IssueTemplate | null;
  remove: (id: string) => void;
  /** merge templates from a bundle; returns how many were added */
  importMany: (items: IssueTemplate[]) => number;
  /** create an issue with the template's fields and return it */
  apply: (id: string) => Issue | null;
}

export const useIssueTemplates = create<TemplateState>((set, get) => ({
  templates: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    const templates = readStorage<IssueTemplate[]>(
      KEY,
      (value) =>
        Array.isArray(value)
          ? (value as IssueTemplate[]).filter(
              (template) => template && typeof template.id === 'string' && typeof template.name === 'string',
            )
          : null,
      [],
    );
    set({ templates, hydrated: true });
  },

  saveFromIssue: (issue, name) => {
    const template: IssueTemplate = {
      id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: (name ?? issue.title).trim().slice(0, 80) || 'Template',
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      labelIds: [...issue.labelIds],
      projectId: issue.projectId,
      estimate: issue.estimate,
      createdAt: Date.now(),
    };
    set((state) => {
      const templates = [template, ...state.templates].slice(0, MAX_TEMPLATES);
      persist(templates);
      return { templates };
    });
    return template;
  },

  remove: (id) => {
    set((state) => {
      const templates = state.templates.filter((template) => template.id !== id);
      persist(templates);
      return { templates };
    });
  },

  importMany: (items) => {
    const valid = items.filter((item) => item && typeof item.name === 'string' && item.name.trim());
    if (!valid.length) return 0;
    set((state) => {
      const existing = new Set(state.templates.map((template) => template.name + '|' + template.title));
      const fresh = valid
        .filter((item) => !existing.has(item.name + '|' + item.title))
        .map((item) => ({
          ...item,
          id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        }));
      const templates = [...fresh, ...state.templates].slice(0, MAX_TEMPLATES);
      persist(templates);
      return { templates };
    });
    return valid.length;
  },

  apply: (id) => {
    const template = get().templates.find((entry) => entry.id === id);
    if (!template) return null;
    const data = useData.getState();
    const issue = data.createIssue({
      title: template.title,
      status: template.status,
      priority: template.priority,
      projectId: template.projectId,
    });
    if (template.description) data.patchIssue(issue.id, { description: template.description });
    for (const labelId of template.labelIds) {
      if (data.labels.some((label) => label.id === labelId)) data.toggleLabel(issue.id, labelId);
    }
    if (template.estimate !== null) data.setEstimate(issue.id, template.estimate);
    return issue;
  },
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_TEMPLATES__?: typeof useIssueTemplates }).__AETHER_TEMPLATES__ = useIssueTemplates;
}
