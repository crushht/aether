'use client';

import { create } from 'zustand';
import { currentUserId } from '@/lib/session';
import { readStorage, writeStorage } from './storage';
import { useData } from './data';
import type { Project } from '@/lib/types';

export interface ProjectTemplate {
  id: string;
  name: string;
  summary: string;
  agentInstructions: string;
  knowledgeIds: string[];
  health: Project['health'];
  createdAt: number;
}

const KEY = `linear-lab:project-templates:${currentUserId()}`;
const MAX = 30;

const persist = (templates: ProjectTemplate[]) => writeStorage(KEY, templates.slice(0, MAX));

interface State {
  templates: ProjectTemplate[];
  hydrated: boolean;
  hydrate: () => void;
  saveFromProject: (project: Project, name?: string) => ProjectTemplate | null;
  createFromTemplate: (id: string, name?: string) => string | null;
  remove: (id: string) => void;
  importMany: (items: ProjectTemplate[]) => number;
}

export const useProjectTemplates = create<State>((set, get) => ({
  templates: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return;
    const templates = readStorage<ProjectTemplate[]>(
      KEY,
      (value) =>
        Array.isArray(value)
          ? (value as ProjectTemplate[]).filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
          : null,
      [],
    );
    set({ templates, hydrated: true });
  },

  saveFromProject: (project, name) => {
    const template: ProjectTemplate = {
      id: `prjtpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: (name ?? project.name).trim().slice(0, 80) || 'Project template',
      summary: project.summary,
      agentInstructions: project.agentInstructions ?? '',
      knowledgeIds: [...(project.knowledgeIds ?? [])],
      health: project.health,
      createdAt: Date.now(),
    };
    set((state) => {
      const templates = [template, ...state.templates].slice(0, MAX);
      persist(templates);
      return { templates };
    });
    return template;
  },

  createFromTemplate: (id, name) => {
    const template = get().templates.find((item) => item.id === id);
    if (!template) return null;
    const data = useData.getState();
    const project = data.createProject({
      name: (name ?? template.name).trim().slice(0, 120) || template.name,
      summary: template.summary,
    });
    data.updateProject(project.id, {
      agentInstructions: template.agentInstructions,
      knowledgeIds: template.knowledgeIds,
      health: template.health,
    });
    return project.id;
  },

  remove: (id) => {
    set((state) => {
      const templates = state.templates.filter((item) => item.id !== id);
      persist(templates);
      return { templates };
    });
  },

  importMany: (items) => {
    const valid = items.filter((item) => item && typeof item.name === 'string' && item.name.trim());
    if (!valid.length) return 0;
    set((state) => {
      const existing = new Set(state.templates.map((template) => template.name + '|' + template.summary));
      const fresh = valid
        .filter((item) => !existing.has(item.name + '|' + item.summary))
        .map((item) => ({
          ...item,
          id: `prjtpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: Date.now(),
        }));
      const templates = [...fresh, ...state.templates].slice(0, MAX);
      persist(templates);
      return { templates };
    });
    return valid.length;
  },
}));

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_PROJECT_TEMPLATES__?: typeof useProjectTemplates }).__AETHER_PROJECT_TEMPLATES__ =
    useProjectTemplates;
}
