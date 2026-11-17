'use client';

import { create } from 'zustand';
import type {
  Activity,
  Cycle,
  Issue,
  IssueAttachment,
  Label,
  Priority,
  Project,
  ProjectUpdate,
  ProjectUpdateAudit,
  StatusKey,
} from '../types';
import { RELATION_INVERSE } from '../types';
import { initialIssues, labels as seedLabels } from '../mock-data';
import { currentUserId } from '../session';
import { useNotificationPrefs } from './notification-prefs';
import { localDayKey, summarizeDay } from '@/lib/notification-digest';
import { pruneExpiredArchives } from '@/lib/notification-retention';
import { uid } from '../utils';
import type { DataState } from './data-types';
import {
  clearIssueHistory,
  recordIssueHistory,
  redoIssueHistory,
  undoIssueHistory,
  type IssueHistorySnapshot,
} from './history';

const STORAGE_KEY = `linear-lab:data:v1:${currentUserId()}`;

/** Real clock: a workspace the user fills in should date its own work. */
const stamp = () => new Date().toISOString();

function activity(actorId: string, kind: Activity['kind'], from?: string, to?: string): Activity {
  return { id: uid('act'), actorId, kind, from, to, createdAt: stamp() };
}

/** Transport state, shown to the person so a failed save is never silent. */

export const useData = create<DataState>((set, get) => {  type Snapshot = Pick<DataState, 'issues' | 'labels' | 'projects' | 'cycles' | 'notifications'>;

  const emptySnapshot = (): Snapshot => ({ issues: [], labels: [], projects: [], cycles: [], notifications: [] });

  /** A write that started from an older server version is refused instead of
   *  silently overwriting someone else's work. */
  let pushing = false;
  let queued: Snapshot | null = null;
  /** true while local changes have not reached the server yet */
  let dirty = false;
  let remoteTimer: number | null = null;
  /** bumped by every local data change, so a slow first GET cannot eat edits */
  let localWrites = 0;

  // Buffer set() calls during a batch. Reads inside the batch see the buffered
  // state too, so a loop over selected issues behaves exactly like a solo edit.
  let bufferedState: DataState | null = null;
  type IssueUpdate = Partial<DataState> | ((state: DataState) => Partial<DataState>);
  const setData = (update: IssueUpdate) => {
    if (!bufferedState) {
      set(update);
      return;
    }
    const partial = typeof update === 'function' ? update(bufferedState) : update;
    bufferedState = { ...bufferedState, ...partial };
  };
  const readData = () => bufferedState ?? get();
  const issueSnapshot = (): IssueHistorySnapshot => ({
    issues: readData().issues,
    notifications: readData().notifications,
  });
  const record = (before: IssueHistorySnapshot) => recordIssueHistory(before, issueSnapshot());
  const tracked = (operation: () => void) => {
    get().batchIssues(operation);
  };
  const trackedSet = (operation: IssueUpdate) => tracked(() => setData(operation));

  const pushToServer = async (snapshot: Snapshot, baseVersion = get().serverVersion) => {
    if (pushing) {
      queued = snapshot;
      return;
    }
    pushing = true;
    dirty = true;
    set({ syncState: 'saving' });
    try {
      const response = await fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, baseVersion }),
      });
      if (response.ok) {
        const json = (await response.json().catch(() => ({}))) as { updatedAt?: number };
        dirty = false;
        set({
          storageMode: 'server',
          serverVersion: json.updatedAt ?? get().serverVersion,
          syncState: 'saved',
          lastSavedAt: Date.now(),
          conflictedAt: null,
        });
        return;
      }
      if (response.status === 409) {
        // Keep both sides. The person decides; nothing is silently overwritten.
        set({ syncState: 'conflict', conflictedAt: Date.now() });
        queued = null;
        return;
      }
      set({ storageMode: 'local', syncState: 'offline' });
    } catch {
      set({ storageMode: 'local', syncState: 'offline' });
    } finally {
      pushing = false;
      if (queued && get().syncState !== 'conflict') {
        const next = queued;
        queued = null;
        void pushToServer(next);
      }
    }
  };

  /** Remote wins per issue, unless the local copy is newer. */
  const mergeIssues = (remote: Issue[], local: Issue[]): Issue[] => {
    if (!local.length) return remote;
    const byId = new Map(remote.map((issue) => [issue.id, issue]));
    const extra: Issue[] = [];
    for (const issue of local) {
      const other = byId.get(issue.id);
      if (!other) {
        extra.push(issue);
        continue;
      }
      if (+new Date(issue.updatedAt) >= +new Date(other.updatedAt)) byId.set(issue.id, issue);
    }
    return [...extra, ...remote.map((issue) => byId.get(issue.id) ?? issue)];
  };

  const mergeById = <T extends { id: string }>(remote: T[], local: T[]): T[] => {
    if (!local.length) return remote;
    const seen = new Set(remote.map((row) => row.id));
    return [...remote, ...local.filter((row) => !seen.has(row.id))];
  };

  /**
   * Create the cycle that follows `source`, carrying its unfinished issues.
   * Idempotent: a source that already has a successor returns it.
   */
  const openSuccessor = (
    source: Cycle,
    options: { notify: boolean; onlyWhenCarrying: boolean },
  ): Cycle | null => {
    const existing = get().cycles.find((cycle) => cycle.previousId === source.id);
    if (existing) return existing;

    const closed = new Set(['done', 'canceled', 'duplicate']);
    const carried = get().issues.filter((issue) => issue.cycleId === source.id && !closed.has(issue.status));
    if (options.onlyWhenCarrying && !carried.length) return null;

    const cycles = get().cycles;
    const number = cycles.reduce((max, cycle) => Math.max(max, cycle.number), 0) + 1;
    // never open a window that lies entirely in the past
    const startsAt = new Date(Math.max(Date.now(), +new Date(source.endsAt)));
    const next: Cycle = {
      id: `c${number}`,
      name: `Cycle ${number}`,
      number,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 14 * 86_400_000).toISOString(),
      progress: 0,
      previousId: source.id,
    };

    set((state) => ({
      cycles: [...state.cycles, next],
      issues: state.issues.map((issue) =>
        issue.cycleId === source.id && !closed.has(issue.status)
          ? { ...issue, cycleId: next.id, updatedAt: stamp() }
          : issue,
      ),
      notifications:
        options.notify && carried.length
          ? [
              {
                id: uid('ntf'),
                issueId: carried[0].id,
                kind: 'cycle' as const,
                count: carried.length,
                cycleName: next.name,
                cycleId: next.id,
                event: 'rollover' as const,
                createdAt: stamp(),
              },
              ...state.notifications,
            ].slice(0, 50)
          : state.notifications,
    }));

    return next;
  };

  let timer: number | null = null;

  return {
    hydrated: false,
    storageMode: 'local',
    serverVersion: 0,
    syncState: 'idle',
    lastSavedAt: null,
    conflictedAt: null,
    remoteUpdatedAt: null,
    hydrate: () => {
      if (get().hydrated || typeof window === 'undefined') return;

      let local: Snapshot = emptySnapshot();
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<Snapshot>;
          local = {
            issues: Array.isArray(saved.issues) ? saved.issues : [],
            labels: Array.isArray(saved.labels) ? saved.labels : [],
            projects: Array.isArray(saved.projects) ? saved.projects : [],
            cycles: Array.isArray(saved.cycles) ? saved.cycles : [],
            notifications: Array.isArray(saved.notifications) ? saved.notifications : [],
          };
        }
      } catch {
        /* malformed cache */
      }
      set({ ...local, hydrated: true });

      // the server is the source of truth once it has content; a local-only
      // workspace is migrated up on first contact
      const writesAtFetch = localWrites;
      void (async () => {
        try {
          const response = await fetch('/api/workspace', { cache: 'no-store' });
          if (!response.ok) return;
          const snapshot = (await response.json()) as Partial<Snapshot> & {
            updatedAt?: number;
            server?: boolean;
            mode?: 'shared' | 'personal';
          };
          const version = snapshot.updatedAt ?? 0;
          const serverHasData = Boolean(
            snapshot.issues?.length || snapshot.labels?.length || snapshot.projects?.length || snapshot.cycles?.length,
          );
          const localHasData = Boolean(
            local.issues.length || local.labels.length || local.projects.length || local.cycles.length,
          );

          if (serverHasData) {
            // edits made while the GET was in flight must survive it
            const touched = localWrites > writesAtFetch;
            const current = get();
            set({
              issues: touched ? mergeIssues(snapshot.issues ?? [], current.issues) : (snapshot.issues ?? []),
              labels: touched ? mergeById(snapshot.labels ?? [], current.labels) : (snapshot.labels ?? []),
              projects: touched ? mergeById(snapshot.projects ?? [], current.projects) : (snapshot.projects ?? []),
              cycles: touched ? mergeById(snapshot.cycles ?? [], current.cycles) : (snapshot.cycles ?? []),
              notifications: touched
                ? mergeById(snapshot.notifications ?? [], current.notifications)
                : (snapshot.notifications ?? []),
              storageMode: 'server',
              serverVersion: version,
              syncState: 'saved',
              lastSavedAt: Date.now(),
            });
          } else {
            // a *fresh* server file accepts this browser's data (first run);
            // an explicitly reset one (updatedAt > 0, empty) must also clear
            // whatever this browser still has cached, or the reset never lands
            const serverWasReset = version > 0;
            set({
              storageMode: 'server',
              serverVersion: version,
              ...(serverWasReset ? emptySnapshot() : {}),
            });
            if (localHasData && !version) await pushToServer(local);
          }
        } catch {
          set({ storageMode: 'local' });
        }
        // a cycle that already ended rolls over once, on the first load of the day
        get().ensureCycleRollover();
      })();

      useData.subscribe((state, previous) => {
        if (!state.hydrated) return;
        // transport metadata (`serverVersion`) changes on every successful
        // write; only real content changes may schedule another write, or the
        // store would keep re-saving itself forever
        const changed =
          state.issues !== previous.issues ||
          state.labels !== previous.labels ||
          state.projects !== previous.projects ||
          state.cycles !== previous.cycles ||
          state.notifications !== previous.notifications;
        if (!changed) return;
        localWrites += 1;
        dirty = true;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const snapshot: Snapshot = {
            issues: state.issues,
            labels: state.labels,
            projects: state.projects,
            cycles: state.cycles,
            notifications: state.notifications,
          };
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
          } catch {
            /* quota */
          }
          void pushToServer(snapshot);
        }, 500);
      });
    },
    resetWorkspace: () => {
      clearIssueHistory();
      const empty = emptySnapshot();
      set({ ...empty, hydrated: true });
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      void pushToServer(empty);
    },

    /**
     * A first run should not face a blank page. Every row here goes through the
     * normal actions, so history, audit and notifications stay consistent.
     */
    seedWorkspace: () => {
      const me = currentUserId();
      const search = get().createProject({ name: '搜索重构', summary: '把检索做快、做准。', status: 'in_progress' });
      const mobile = get().createProject({ name: '移动端', summary: '让手机上也能顺手用。', status: 'planned' });
      const cycle = get().createCycle({ name: '第 1 个周期', days: 14 });
      const bug = get().addLabel('bug');
      const feature = get().addLabel('feature');

      const seed = (title: string, status: StatusKey, priority: Priority, projectId: string | null, labels: string[] = []) => {
        const issue = get().createIssue({ title, status, priority, projectId, assigneeId: me });
        for (const labelId of labels) get().toggleLabel(issue.id, labelId);
        if (cycle) get().setCycle(issue.id, cycle.id);
        return issue;
      };

      const sort = seed('检索结果按相关度排序', 'in_progress', 'high', search.id, [feature.id]);
      seed('空查询时展示最近搜索', 'todo', 'medium', search.id, [feature.id]);
      const cjk = seed('中文分词漏掉双字词', 'todo', 'urgent', search.id, [bug.id]);
      seed('搜索结果高亮命中词', 'done', 'low', search.id, [feature.id]);
      seed('移动端底部导航', 'todo', 'medium', mobile.id);
      seed('离线时保存草稿', 'in_progress', 'high', mobile.id);
      seed('补充键盘快捷键文档', 'todo', 'low', null);
      seed('清理未使用的依赖', 'done', 'low', null);

      get().addComment(cjk.id, me, '复现：搜索「测试」只返回单词结果。');
      get().addProjectUpdate(search.id, '本周把检索延迟从 420ms 降到 180ms。', 'on_track');
      void sort;
    },

    replaceWorkspace: ({ issues, labels, projects, cycles, notifications = [] }) => {
      clearIssueHistory();
      const payload: Snapshot = {
        issues: Array.isArray(issues) ? issues : [],
        labels: Array.isArray(labels) ? labels : [],
        projects: Array.isArray(projects) ? projects : [],
        cycles: Array.isArray(cycles) ? cycles : [],
        notifications: Array.isArray(notifications) ? notifications : [],
      };
      set({ ...payload, hydrated: true, storageMode: 'server' });
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* quota */
      }
      void pushToServer(payload);
    },

    refresh: async (force = false) => {
      if (!get().hydrated) return;
      // A background pull must never eat edits that have not reached the server
      // yet, nor a conflict the person still has to resolve.
      if (!force && (pushing || dirty || get().syncState === 'conflict')) return;
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        if (!response.ok) {
          set({ syncState: 'offline' });
          return;
        }
        const snapshot = (await response.json()) as Partial<Snapshot> & { updatedAt?: number; unchanged?: boolean };
        if (snapshot.unchanged) {
          set({ storageMode: 'server', syncState: 'saved', lastSavedAt: Date.now(), remoteUpdatedAt: null });
          return;
        }
        const current = get();
        const next = {
          issues: snapshot.issues ?? [],
          labels: snapshot.labels ?? [],
          projects: snapshot.projects ?? [],
          cycles: snapshot.cycles ?? [],
          notifications: snapshot.notifications ?? [],
          serverVersion: snapshot.updatedAt ?? current.serverVersion,
          storageMode: 'server' as const,
          syncState: 'saved' as const,
          lastSavedAt: Date.now(),
        };
        const same =
          JSON.stringify(next.issues) === JSON.stringify(current.issues) &&
          JSON.stringify(next.labels) === JSON.stringify(current.labels) &&
          JSON.stringify(next.projects) === JSON.stringify(current.projects) &&
          JSON.stringify(next.cycles) === JSON.stringify(current.cycles) &&
          JSON.stringify(next.notifications) === JSON.stringify(current.notifications);
        if (!same) set({ ...next, remoteUpdatedAt: null });
        else set({ serverVersion: next.serverVersion, storageMode: 'server', syncState: 'saved', lastSavedAt: Date.now(), remoteUpdatedAt: null });
      } catch {
        set({ syncState: 'offline', storageMode: 'local' });
      }
    },

    noteRemoteChange: (updatedAt) => {
      if (!Number.isFinite(updatedAt) || updatedAt <= get().serverVersion) return;
      set({ remoteUpdatedAt: updatedAt });
      // With local edits or an open conflict, surface the change instead of
      // pulling over the person; otherwise debounce a clean pull.
      if (pushing || dirty || get().syncState === 'conflict') return;
      if (remoteTimer) window.clearTimeout(remoteTimer);
      remoteTimer = window.setTimeout(() => {
        remoteTimer = null;
        void get().refresh();
      }, 900);
    },

    mergeConflict: async () => {
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        if (!response.ok) {
          set({ syncState: 'offline' });
          return;
        }
        const remote = (await response.json()) as Partial<Snapshot> & { updatedAt?: number };
        if (!Array.isArray(remote.issues) || !Array.isArray(remote.labels) || !Array.isArray(remote.projects) || !Array.isArray(remote.cycles)) {
          return;
        }
        const current = get();
        const merged: Snapshot = {
          issues: mergeIssues(remote.issues, current.issues),
          labels: mergeById(remote.labels, current.labels),
          projects: mergeById(remote.projects, current.projects),
          cycles: mergeById(remote.cycles, current.cycles),
          notifications: mergeById(remote.notifications ?? [], current.notifications),
        };
        const baseVersion = remote.updatedAt ?? current.serverVersion;
        set({
          ...merged,
          serverVersion: baseVersion,
          conflictedAt: null,
          remoteUpdatedAt: null,
          syncState: 'idle',
        });
        // write the merged copy over the remote, based on the version just read
        await pushToServer(merged, baseVersion);
      } catch {
        set({ syncState: 'offline', storageMode: 'local' });
      }
    },

    resolveConflict: async (choice) => {
      const current = get();
      const snapshot: Snapshot = {
        issues: current.issues,
        labels: current.labels,
        projects: current.projects,
        cycles: current.cycles,
        notifications: current.notifications,
      };
      if (choice === 'remote') {
        dirty = false;
        queued = null;
        set({ conflictedAt: null, syncState: 'idle' });
        await get().refresh(true);
        return;
      }
      // keep this browser's data: read the newest version once, then write over it
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        const server = (await response.json().catch(() => ({}))) as { updatedAt?: number };
        set({ serverVersion: server.updatedAt ?? current.serverVersion, conflictedAt: null, syncState: 'idle' });
        await pushToServer(snapshot, server.updatedAt ?? current.serverVersion);
      } catch {
        set({ syncState: 'offline', storageMode: 'local' });
      }
    },
    issues: initialIssues,
    labels: seedLabels,
    projects: [],
    cycles: [],
    notifications: [],

  getIssue: (id) => readData().issues.find((i) => i.id === id),

  batchIssues: (operation) => {
    if (bufferedState) {
      operation();
      return;
    }
    const before = issueSnapshot();
    bufferedState = get();
    try {
      operation();
    } finally {
      const after = bufferedState;
      bufferedState = null;
      const changed = after.issues !== before.issues || after.notifications !== before.notifications;
      if (changed) {
        // set(), rather than setState(), also replaces transport metadata.
        set({ issues: after.issues, notifications: after.notifications });
        record(before);
      }
    }
  },

  undoIssues: () => undoIssueHistory((snapshot) => set(snapshot)),
  redoIssues: () => redoIssueHistory((snapshot) => set(snapshot)),

  patchIssue: (id, patch, act) =>
    trackedSet((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id
          ? {
              ...issue,
              ...patch,
              updatedAt: stamp(),
              activities: act ? [...issue.activities, act] : issue.activities,
            }
          : issue,
      ),
    })),

  setStatus: (id, status, actorId = currentUserId()) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (!issue || issue.status === status) return;
    readData().patchIssue(id, { status }, activity(actorId, 'status', issue.status, status));
  },

  setPriority: (id, priority, actorId = currentUserId()) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (!issue || issue.priority === priority) return;
    readData().patchIssue(id, { priority }, activity(actorId, 'priority', issue.priority, priority));
  },

  setAssignee: (id, assigneeId, actorId = currentUserId()) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (!issue || issue.assigneeId === assigneeId) return;
    readData().patchIssue(id, { assigneeId }, activity(actorId, 'assignee', issue.assigneeId ?? undefined, assigneeId ?? undefined));
  },

  toggleLabel: (id, labelId) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (!issue) return;
    const next = issue.labelIds.includes(labelId)
      ? issue.labelIds.filter((l) => l !== labelId)
      : [...issue.labelIds, labelId];
    readData().patchIssue(id, { labelIds: next });
  },

  setProject: (id, projectId) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (issue && issue.projectId !== projectId) readData().patchIssue(id, { projectId });
  },
  setCycle: (id, cycleId) => {
    const issue = readData().issues.find((i) => i.id === id);
    if (issue && issue.cycleId !== cycleId) readData().patchIssue(id, { cycleId });
  },
  setEstimate: (id, estimate) => get().patchIssue(id, { estimate }),
  starIssue: (id) => {
    const issue = get().issues.find((i) => i.id === id);
    if (issue) get().patchIssue(id, { starred: !issue.starred });
  },

  addComment: (id, authorId, body, attachments, mentions) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id
          ? {
              ...issue,
              updatedAt: stamp(),
              comments: [
                ...issue.comments,
                {
                  id: uid('cmt'),
                  authorId,
                  body,
                  createdAt: stamp(),
                  ...(attachments?.length ? { attachments } : {}),
                  ...(mentions?.length ? { mentions } : {}),
                },
              ],
              activities: [...issue.activities, activity(authorId, 'comment')],
            }
          : issue,
      ),
    })),

  deleteComment: (id, commentId) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id
          ? {
              ...issue,
              updatedAt: stamp(),
              comments: issue.comments.filter((comment) => comment.id !== commentId),
              activities: [...issue.activities, { ...activity(currentUserId(), 'comment'), detail: 'deleted' }],
            }
          : issue,
      ),
    })),

  addAttachment: (id, input) => {
    const issue = get().issues.find((item) => item.id === id);
    if (!issue) return null;
    const current = issue.attachments ?? [];
    if (current.length >= 10) return null;
    const attachment: IssueAttachment = {
      id: uid('att'),
      createdAt: stamp(),
      uploaderId: currentUserId(),
      ...input,
    };
    get().patchIssue(
      id,
      { attachments: [...current, attachment] },
      activity(currentUserId(), 'attachment', undefined, undefined),
    );
    return attachment;
  },

  removeAttachment: (id, attachmentId) =>
    get().patchIssue(id, {
      attachments: (get().issues.find((item) => item.id === id)?.attachments ?? []).filter(
        (item) => item.id !== attachmentId,
      ),
    }),

  editComment: (id, commentId, body) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id
          ? {
              ...issue,
              updatedAt: stamp(),
              comments: issue.comments.map((comment) =>
                comment.id === commentId ? { ...comment, body } : comment,
              ),
              activities: [...issue.activities, { ...activity(currentUserId(), 'comment'), detail: 'edited' }],
            }
          : issue,
      ),
    })),

  addActivity: (id, kind, detail, actorId = currentUserId()) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id
          ? {
              ...issue,
              updatedAt: stamp(),
              activities: [...issue.activities, { ...activity(actorId, kind), detail }],
            }
          : issue,
      ),
    })),

  createIssue: ({ title, status = 'todo', priority = 'none', assigneeId = null, parentId = null, projectId = null }) => {
    // Keys are human-readable and may be reused after a delete; `id` must not
    // be, or a new issue would inherit an old one's notifications and links.
    const maxN = get().issues.reduce((m, i) => Math.max(m, Number(i.key.split('-')[1]) || 0), 0);
    const key = `ENG-${maxN + 1}`;
    const issue: Issue = {
      id: uid('iss'),
      key,
      teamKey: 'ENG',
      title,
      description: '',
      status,
      priority,
      assigneeId,
      creatorId: currentUserId(),
      labelIds: [],
      projectId,
      cycleId: null,
      estimate: null,
      dueDate: null,
      createdAt: stamp(),
      updatedAt: stamp(),
      comments: [],
      activities: [activity(currentUserId(), 'created')],
      parentId,
    };
    set((state) => ({ issues: [issue, ...state.issues] }));
    return issue;
  },

  deleteIssues: (ids) => {
    const removing = new Set(ids);
    if (!readData().issues.some((issue) => removing.has(issue.id))) return;
    trackedSet((state) => ({
      // Keep the surrounding graph and inbox byte-for-byte. The full pre-delete
      // snapshot restores both the issue and its original position on undo.
      issues: state.issues.filter((issue) => !removing.has(issue.id)),
    }));
  },

  addRelation: (id, type, targetId) =>
    set((state) => {
      if (id === targetId) return state;
      const source = state.issues.find((i) => i.id === id);
      if (!source) return state;
      if ((source.relations ?? []).some((r) => r.issueId === targetId)) return state;
      return {
        issues: state.issues.map((issue) => {
          if (issue.id === id) {
            return {
              ...issue,
              updatedAt: stamp(),
              relations: [...(issue.relations ?? []), { type, issueId: targetId }],
            };
          }
          if (issue.id === targetId) {
            return {
              ...issue,
              updatedAt: stamp(),
              relations: [...(issue.relations ?? []), { type: RELATION_INVERSE[type], issueId: id }],
            };
          }
          return issue;
        }),
      };
    }),

  removeRelation: (id, targetId) =>
    set((state) => ({
      // one link lives on two issues; removing it from either side clears both
      issues: state.issues.map((issue) => {
        if (issue.id !== id && issue.id !== targetId) return issue;
        const other = issue.id === id ? targetId : id;
        const relations = (issue.relations ?? []).filter((r) => r.issueId !== other);
        if (relations.length === (issue.relations ?? []).length) return issue;
        return { ...issue, updatedAt: stamp(), relations };
      }),
    })),

  moveIssue: (id, status, beforeId) =>
    trackedSet((state) => {
      const moving = state.issues.find((i) => i.id === id);
      if (!moving || (moving.status === status && beforeId === id)) return state;
      const rest = state.issues.filter((i) => i.id !== id);
      // a drag that changes the column is a status change: it must leave a trace
      const changed = moving.status !== status;
      const updated = {
        ...moving,
        status,
        updatedAt: stamp(),
        activities: changed
          ? [...moving.activities, activity(currentUserId(), 'status', moving.status, status)]
          : moving.activities,
      };
      const at = beforeId ? rest.findIndex((i) => i.id === beforeId) : -1;
      if (at === -1) {
        const lastOfStatus = [...rest].reverse().findIndex((i) => i.status === status);
        const insertAt = lastOfStatus === -1 ? rest.length : rest.length - lastOfStatus;
        return {
          issues: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)],
        };
      }
      return { issues: [...rest.slice(0, at), updated, ...rest.slice(at)] };
    }),

  reorder: (status, orderedIds) =>
    trackedSet((state) => {
      const byId = new Map(state.issues.map((i) => [i.id, i]));
      const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Issue[];
      const rest = state.issues.filter((i) => !orderedIds.includes(i.id));
      const firstIndex = state.issues.findIndex((i) => orderedIds.includes(i.id));
      const insertAt = firstIndex === -1 ? rest.length : firstIndex;
      return { issues: [...rest.slice(0, insertAt), ...ordered, ...rest.slice(insertAt)] };
    }),

  addLabel: (name) => {
    const palette = ['#EB5757', '#5E6AD2', '#27A644', '#F79CE0', '#FC7840', '#F0BF00', '#00B8CC'];
    const label: Label = {
      id: uid('lb'),
      name,
      color: palette[get().labels.length % palette.length],
    };
    set((state) => ({ labels: [...state.labels, label] }));
    return label;
  },

  createCycle: ({ name, days = 14 } = {}) => {
    const number = get().cycles.reduce((max, cycle) => Math.max(max, cycle.number), 0) + 1;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + days * 86_400_000);
    const cycle: Cycle = {
      id: `c${number}`,
      name: name?.trim() || `Cycle ${number}`,
      number,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      progress: 0,
    };
    set((state) => ({ cycles: [...state.cycles, cycle] }));
    return cycle;
  },

  /**
   * Close a cycle by opening its successor: unfinished issues move forward,
   * the new window starts `max(now, endsAt)` so it can never land in the past,
   * and a cycle that was already rolled over returns its successor instead of
   * creating another one.
   */
  rolloverCycle: (cycleId) => {
    const source = get().cycles.find((cycle) => cycle.id === cycleId);
    if (!source) return null;
    return openSuccessor(source, { notify: false, onlyWhenCarrying: false });
  },

  ensureCycleRollover: () => {
    const now = Date.now();
    const cycles = get().cycles;
    if (cycles.length) {
      const latest = [...cycles].sort((a, b) => +new Date(a.endsAt) - +new Date(b.endsAt)).at(-1);
      if (latest && +new Date(latest.endsAt) < now) {
        // once per successor: a cycle that already has one is skipped
        if (!cycles.some((cycle) => cycle.previousId === latest.id)) {
          openSuccessor(latest, { notify: true, onlyWhenCarrying: true });
        }
      }
    }
    get().ensureCycleNotices();
    get().ensureDailyDigest();
    const kept = pruneExpiredArchives(get().notifications);
    if (kept.length !== get().notifications.length) set({ notifications: kept });
  },

  ensureDailyDigest: () => {
    const dayKey = localDayKey();
    if (get().notifications.some((notification) => notification.kind === 'digest' && notification.digestDate === dayKey)) {
      return;
    }
    const summary = summarizeDay(get().notifications, dayKey);
    if (!summary.total) return;
    get().pushNotification({
      issueId: '',
      kind: 'digest',
      digestDate: dayKey,
      digest: summary,
      count: summary.total,
    });
  },

  ensureCycleNotices: () => {
    const now = Date.now();
    const cycle = get().cycles.find(
      (item) => +new Date(item.startsAt) <= now && now <= +new Date(item.endsAt),
    );
    if (!cycle) return;
    const inCycle = get().issues.filter((issue) => issue.cycleId === cycle.id);
    const done = inCycle.filter((issue) => ['done', 'canceled', 'duplicate'].includes(issue.status)).length;
    const unfinished = inCycle.length - done;
    const firstIssue = inCycle.find((issue) => !['done', 'canceled', 'duplicate'].includes(issue.status)) ?? inCycle[0];

    const notifyOnce = (event: 'started' | 'ending', count: number) => {
      if (get().notifications.some((item) => item.cycleId === cycle.id && item.event === event)) return;
      get().pushNotification({
        issueId: firstIssue?.id ?? '',
        kind: 'cycle',
        cycleId: cycle.id,
        cycleName: cycle.name,
        event,
        count,
      });
    };

    if (now - +new Date(cycle.startsAt) <= 86_400_000) notifyOnce('started', inCycle.length);
    if (+new Date(cycle.endsAt) - now <= 86_400_000) notifyOnce('ending', unfinished);
  },

  setNotificationArchived: (id, archived) =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id
          ? { ...notification, archivedAt: archived ? stamp() : undefined }
          : notification,
      ),
    })),

  snoozeNotification: (id, until) =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id
          ? {
              ...notification,
              snoozedUntil:
                typeof until === 'number' && Number.isFinite(until) ? new Date(until).toISOString() : undefined,
            }
          : notification,
      ),
    })),

  deleteNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),

  pushNotification: (input) => {
    const prefs = useNotificationPrefs.getState();
    prefs.hydrate();
    if (!prefs.enabled('inbox', input.kind)) return;
    set((state) => ({
      notifications: [
        { ...input, id: uid('ntf'), createdAt: stamp() },
        ...state.notifications,
      ].slice(0, 50),
    }));
  },

  toggleUpdateReaction: (id, updateId, kind) => {
    const me = currentUserId();
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== id) return project;
        const target = (project.updates ?? []).find((update) => update.id === updateId);
        if (!target) return project;
        const key = kind === 'like' ? 'likedBy' : 'acknowledgedBy';
        const list = target[key] ?? [];
        const removing = list.includes(me);
        const action: ProjectUpdateAudit['action'] =
          kind === 'like'
            ? removing
              ? 'unliked'
              : 'liked'
            : removing
              ? 'unacknowledged'
              : 'acknowledged';
        return {
          ...project,
          updates: (project.updates ?? []).map((update) =>
            update.id === updateId
              ? { ...update, [key]: removing ? list.filter((userId) => userId !== me) : [...list, me] }
              : update,
          ),
          updateAudit: [
            {
              id: uid('paud'),
              updateId,
              action,
              actorId: me,
              at: stamp(),
              summary: kind === 'like' ? 'like' : 'acknowledge',
            },
            ...(project.updateAudit ?? []),
          ].slice(0, 50),
        };
      }),
    }));
  },

  createProject: ({ name, summary = '', status = 'planned' }) => {
    const palette = ['#5E6AD2', '#B87CF0', '#00B8CC', '#27A644', '#FC7840', '#F79CE0'];
    const project: Project = {
      id: uid('prj'),
      name,
      summary,
      status,
      leadId: currentUserId(),
      memberIds: [currentUserId()],
      targetDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      progress: 0,
      health: 'on_track',
      color: palette[get().projects.length % palette.length],
      icon: name.trim().slice(0, 1).toUpperCase() || 'P',
    };
    set((state) => ({ projects: [project, ...state.projects] }));
    return project;
  },

  updateProject: (id, patch) => set((state) => ({
    projects: state.projects.map((project) => project.id === id ? { ...project, ...patch } : project),
  })),

  addProjectUpdate: (id, body, health, attachments) => {
    const text = body.trim();
    if (!text) return;
    const update: ProjectUpdate = {
      id: uid('pupd'),
      body: text.slice(0, 4_000),
      ...(health ? { health } : {}),
      ...(attachments?.length ? { attachments: attachments.slice(0, 5) } : {}),
      authorId: currentUserId(),
      createdAt: stamp(),
    };
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id
          ? {
              ...project,
              // a posted update is also the project's current health statement
              ...(health ? { health } : {}),
              updates: [update, ...(project.updates ?? [])].slice(0, 50),
              updateAudit: [
                {
                  id: uid('paud'),
                  updateId: update.id,
                  action: 'created' as const,
                  actorId: update.authorId,
                  at: update.createdAt,
                  summary: update.body.slice(0, 120),
                },
                ...(project.updateAudit ?? []),
              ].slice(0, 50),
            }
          : project,
      ),
    }));
    const project = get().projects.find((item) => item.id === id);
    get().pushNotification({
      issueId: '',
      kind: 'project_update',
      projectId: id,
      updateId: update.id,
      actorId: update.authorId,
      count: 1,
      projectName: project?.name,
    });
  },

  deleteProjectUpdate: (id, updateId) =>
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== id) return project;
        const target = (project.updates ?? []).find((update) => update.id === updateId);
        return {
          ...project,
          updates: (project.updates ?? []).filter((update) => update.id !== updateId),
          ...(target
            ? {
                updateAudit: [
                  {
                    id: uid('paud'),
                    updateId,
                    action: 'deleted' as const,
                    actorId: currentUserId(),
                    at: stamp(),
                    summary: target.body.slice(0, 120),
                  },
                  ...(project.updateAudit ?? []),
                ].slice(0, 50),
              }
            : {}),
        };
      }),
      // the notice about a deleted update would open a project with nothing new
      notifications: state.notifications.filter((notification) => notification.updateId !== updateId),
    })),

  editProjectUpdate: (id, updateId, patch) => {    const body = patch.body?.trim();
    set((state) => ({
      projects: state.projects.map((project) => {
        if (project.id !== id) return project;
        const target = (project.updates ?? []).find((update) => update.id === updateId);
        if (!target) return project;
        const nextHealth = patch.health ?? target.health;
        return {
          ...project,
          // the latest update's health is the project's current health
          ...(patch.health && (project.updates ?? [])[0]?.id === updateId ? { health: patch.health } : {}),
          updates: (project.updates ?? []).map((update) =>
            update.id === updateId
              ? {
                  ...update,
                  ...(body ? { body: body.slice(0, 4_000) } : {}),
                  ...(nextHealth ? { health: nextHealth } : {}),
                }
              : update,
          ),
          updateAudit: [
            {
              id: uid('paud'),
              updateId,
              action: 'edited' as const,
              actorId: currentUserId(),
              at: stamp(),
              summary: [body ? 'body' : '', patch.health ? 'health' : ''].filter(Boolean).join(' + ') || 'no-op',
            },
            ...(project.updateAudit ?? []),
          ].slice(0, 50),
        };
      }),
    }));
  },

  setProjectStatus: (id, status) =>
    set((state) => ({
      projects: state.projects.map((project) => (project.id === id ? { ...project, status } : project)),
    })),
  };
});

// Dev-only handle so browser acceptance can drive real store actions.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __AETHER_DATA__?: typeof useData }).__AETHER_DATA__ = useData;
}

