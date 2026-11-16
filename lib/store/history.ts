'use client';

import type { AppNotification, Issue } from '../types';

/** Only issue mutations participate; unrelated workspace entities stay untouched. */
export interface IssueHistorySnapshot {
  issues: Issue[];
  notifications: AppNotification[];
}

interface HistoryEntry {
  before: IssueHistorySnapshot;
  after: IssueHistorySnapshot;
}

const LIMIT = 50;
const past: HistoryEntry[] = [];
const future: HistoryEntry[] = [];

export function recordIssueHistory(before: IssueHistorySnapshot, after: IssueHistorySnapshot) {
  if (before.issues === after.issues && before.notifications === after.notifications) return;
  past.push({ before, after });
  if (past.length > LIMIT) past.shift();
  future.length = 0;
}

export function undoIssueHistory(restore: (snapshot: IssueHistorySnapshot) => void): boolean {
  const entry = past.pop();
  if (!entry) return false;
  restore(entry.before);
  future.push(entry);
  return true;
}

export function redoIssueHistory(restore: (snapshot: IssueHistorySnapshot) => void): boolean {
  const entry = future.pop();
  if (!entry) return false;
  restore(entry.after);
  past.push(entry);
  return true;
}

export function clearIssueHistory() {
  past.length = 0;
  future.length = 0;
}
