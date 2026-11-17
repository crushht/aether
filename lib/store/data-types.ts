import type {
  Activity,
  AppNotification,
  Cycle,
  Issue,
  IssueAttachment,
  Label,
  Priority,
  Project,
  ProjectStatus,
  ProjectUpdate,
  RelationType,
  StatusKey,
} from '../types';

export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict';

export interface DataState {
  hydrated: boolean;
  /** reads the persisted workspace once, then keeps it in sync */
  hydrate: () => void;
  resetWorkspace: () => void;
  /** fills an empty workspace with a small, self-consistent demo */
  seedWorkspace: () => void;
  /** replace the whole workspace from a backup file */
  replaceWorkspace: (payload: {
    issues: Issue[];
    labels: Label[];
    projects: Project[];
    cycles: Cycle[];
    notifications?: AppNotification[];
  }) => void;
  /** where the last successful read came from */
  storageMode: 'server' | 'local';
  /** the `updatedAt` this client last saw — sent with every write to detect clobbering */
  serverVersion: number;
  /** visible transport state: saving / saved / offline / conflict */
  syncState: SyncState;
  lastSavedAt: number | null;
  /** non-null while a 409 is waiting for the person to pick a side */
  conflictedAt: number | null;
  /** a newer server version announced by another tab or device */
  remoteUpdatedAt: number | null;
  /** handle a change announced over SSE: pull, or ask the person */
  noteRemoteChange: (updatedAt: number) => void;
  /** pull the server snapshot again (used when the tab regains focus) */
  refresh: (force?: boolean) => Promise<void>;
  /** resolve a 409: keep this browser's data, or load the server's */
  resolveConflict: (choice: 'local' | 'remote') => Promise<void>;
  /** resolve a 409 without dropping either side */
  mergeConflict: () => Promise<void>;
  issues: Issue[];
  labels: Label[];
  projects: Project[];
  cycles: Cycle[];
  notifications: AppNotification[];
  createCycle: (input?: { name?: string; days?: number }) => Cycle;
  /** opens the next cycle and moves this cycle's unfinished issues into it */
  rolloverCycle: (cycleId: string) => Cycle | null;
  /** on load: if the latest cycle already ended, roll it over automatically */
  ensureCycleRollover: () => void;
  /** one-off notices when the current cycle starts or is about to end */
  ensureCycleNotices: () => void;
  /** once a day: summarise today's activity into a single inbox entry */
  ensureDailyDigest: () => void;
  pushNotification: (input: Omit<AppNotification, 'id' | 'createdAt'>) => void;
  /** hide one notification from the inbox, or bring it back */
  setNotificationArchived: (id: string, archived: boolean) => void;
  /** hide until `until` (epoch ms); null wakes it up now */
  snoozeNotification: (id: string, until: number | null) => void;
  deleteNotification: (id: string) => void;
  createProject: (input: { name: string; summary?: string; status?: ProjectStatus }) => Project;
  setProjectStatus: (id: string, status: ProjectStatus) => void;
  updateProject: (id: string, patch: Partial<Pick<Project, 'name' | 'summary' | 'agentInstructions' | 'knowledgeIds' | 'targetDate' | 'health'>>) => void;
  addProjectUpdate: (
    id: string,
    body: string,
    health?: ProjectUpdate['health'],
    attachments?: IssueAttachment[],
  ) => void;
  deleteProjectUpdate: (id: string, updateId: string) => void;
  editProjectUpdate: (
    id: string,
    updateId: string,
    patch: { body?: string; health?: ProjectUpdate['health'] },
  ) => void;
  toggleUpdateReaction: (id: string, updateId: string, kind: 'like' | 'ack') => void;
  getIssue: (id: string) => Issue | undefined;
  /** One user intent = one store commit, one server write and one history entry. */
  batchIssues: (operation: () => void) => void;
  undoIssues: () => boolean;
  redoIssues: () => boolean;
  patchIssue: (id: string, patch: Partial<Issue>, act?: Activity) => void;
  setStatus: (id: string, status: StatusKey, actorId?: string) => void;
  setPriority: (id: string, priority: Priority, actorId?: string) => void;
  setAssignee: (id: string, assigneeId: string | null, actorId?: string) => void;
  toggleLabel: (id: string, labelId: string) => void;
  setProject: (id: string, projectId: string | null) => void;
  setCycle: (id: string, cycleId: string | null) => void;
  setEstimate: (id: string, estimate: number | null) => void;
  starIssue: (id: string) => void;
  addComment: (id: string, authorId: string, body: string, attachments?: IssueAttachment[], mentions?: string[]) => void;
  /** edit one of your own comments; appends an activity row */
  editComment: (id: string, commentId: string, body: string) => void;
  deleteComment: (id: string, commentId: string) => void;
  addAttachment: (id: string, input: Omit<IssueAttachment, 'id' | 'createdAt' | 'uploaderId'>) => IssueAttachment | null;
  removeAttachment: (id: string, attachmentId: string) => void;
  /** appends one activity row; used by the agent when a session ends */
  addActivity: (id: string, kind: Activity['kind'], detail?: string, actorId?: string) => void;
  createIssue: (input: {
    title: string;
    status?: StatusKey;
    priority?: Priority;
    assigneeId?: string | null;
    parentId?: string | null;
    projectId?: string | null;
  }) => Issue;
  addRelation: (id: string, type: RelationType, targetId: string) => void;
  removeRelation: (id: string, targetId: string) => void;
  deleteIssues: (ids: string[]) => void;
  moveIssue: (id: string, status: StatusKey, beforeId?: string | null) => void;
  reorder: (status: StatusKey, orderedIds: string[]) => void;
  addLabel: (name: string) => Label;
}