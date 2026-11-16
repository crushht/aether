export type StatusKey =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'canceled'
  | 'duplicate';

export type Priority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

export type ViewMode = 'list' | 'board';

export interface User {
  id: string;
  name: string;
  handle: string;
  role: string;
  color: string;
  online?: boolean;
  guest?: boolean;
  email?: string;
  createdAt?: string;
  /** refreshed by the server at most every five minutes */
  lastSeenAt?: string | null;
}

/** A workspace member as the server exposes it — no password material. */
export type PublicUser = User;

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Team {
  id: string;
  key: string;
  name: string;
  color: string;
  icon: 'engineering' | 'design' | 'product';
  memberIds: string[];
}

export type ProjectStatus = 'backlog' | 'planned' | 'in_progress' | 'paused' | 'completed';

export interface ProjectUpdate {
  id: string;
  body: string;
  health?: 'on_track' | 'at_risk' | 'off_track';
  authorId: string;
  createdAt: string;
  /** lightweight responses: who liked / acknowledged this update */
  likedBy?: string[];
  acknowledgedBy?: string[];
  /** files posted with the update (same shape as issue attachments) */
  attachments?: IssueAttachment[];
}

export interface ProjectUpdateAudit {
  id: string;
  updateId: string;
  action: 'created' | 'edited' | 'deleted' | 'liked' | 'unliked' | 'acknowledged' | 'unacknowledged';
  actorId: string;
  at: string;
  /** a short, human-readable trace of what changed */
  summary?: string;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  status: ProjectStatus;
  leadId: string;
  memberIds: string[];
  targetDate: string;
  progress: number;
  health: 'on_track' | 'at_risk' | 'off_track';
  color: string;
  icon: string;
  /** project-scoped instructions injected into chats started here */
  agentInstructions?: string;
  /** optional knowledge entries to prefer in project conversations */
  knowledgeIds?: string[];
  /** progress notes posted by people (newest first) */
  updates?: ProjectUpdate[];
  /** append-only record of update creation, edits and deletions */
  updateAudit?: ProjectUpdateAudit[];
}

export interface Cycle {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  progress: number;
  current?: boolean;
  /** set when this cycle was opened by rolling over another one */
  previousId?: string;
}

/** Inbox items are derived from real events, never seeded. */
export interface AppNotification {
  id: string;
  /** the issue the event happened on (cycle rollovers point at the first carried issue) */
  issueId: string;
  kind: 'agent' | 'cycle' | 'mention' | 'project_update' | 'digest';
  /** tool calls for an agent run, carried issues for a rollover, mentions for a comment */
  count?: number;
  cycleName?: string;
  /** who caused it, when that matters (mention / agent) */
  actorId?: string;
  /** cycle notices: which cycle and which moment */
  cycleId?: string;
  event?: 'started' | 'ending' | 'rollover';
  /** project update notices */
  projectId?: string;
  projectName?: string;
  updateId?: string;
  /** daily digest: which day and the counts it summarises */
  digestDate?: string;
  digest?: { total: number; counts: Record<string, number> };
  /** hidden from the inbox but kept in the snapshot */
  archivedAt?: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  /** files attached to this comment (same bounded shape as issue attachments) */
  attachments?: IssueAttachment[];
  /** user ids mentioned with @handle in the body */
  mentions?: string[];
}

/** A small attachment kept inside the workspace snapshot (no object store). */
export interface IssueAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** images only: bounded data URL */
  dataUrl?: string;
  /** text-ish files only: bounded UTF-8 text */
  text?: string;
  uploaderId: string;
  createdAt: string;
}

export type ActivityKind =
  | 'created'
  | 'status'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'project'
  | 'cycle'
  | 'comment'
  | 'attachment'
  | 'estimate'
  | 'agent';

export interface Activity {
  id: string;
  actorId: string;
  kind: ActivityKind;
  from?: string;
  to?: string;
  detail?: string;
  createdAt: string;
}

export type RelationType = 'blocks' | 'blocked_by' | 'related' | 'duplicate' | 'duplicated_by';

/** A one-way link stored on the issue it belongs to; the inverse is stored on the target. */
export interface IssueRelation {
  type: RelationType;
  issueId: string;
}

export const RELATION_INVERSE: Record<RelationType, RelationType> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  related: 'related',
  duplicate: 'duplicated_by',
  duplicated_by: 'duplicate',
};

export interface Issue {
  id: string;
  key: string;
  teamKey: string;
  title: string;
  description: string;
  status: StatusKey;
  priority: Priority;
  assigneeId: string | null;
  creatorId: string;
  labelIds: string[];
  projectId: string | null;
  cycleId: string | null;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  comments: Comment[];
  activities: Activity[];
  /** parent issue id for sub-issues */
  parentId?: string | null;
  relations?: IssueRelation[];
  starred?: boolean;
  attachments?: IssueAttachment[];
}

export interface StatusMeta {
  key: StatusKey;
  label: string;
  color: string;
  group: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export const STATUSES: StatusMeta[] = [
  { key: 'backlog', label: 'Backlog', color: 'var(--status-backlog)', group: 'backlog' },
  { key: 'todo', label: 'Todo', color: 'var(--status-todo)', group: 'unstarted' },
  { key: 'in_progress', label: 'In Progress', color: 'var(--status-progress)', group: 'started' },
  { key: 'in_review', label: 'In Review', color: 'var(--status-review)', group: 'started' },
  { key: 'done', label: 'Done', color: 'var(--status-done)', group: 'completed' },
  { key: 'canceled', label: 'Canceled', color: 'var(--status-canceled)', group: 'canceled' },
  { key: 'duplicate', label: 'Duplicate', color: 'var(--status-canceled)', group: 'canceled' },
];

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 'none', label: 'No priority' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];
