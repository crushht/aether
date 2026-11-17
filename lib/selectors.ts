import type { Issue } from './types';
import { sortIssues, type Filters, type IssueScope, type SortKey, type TabKey } from './store/view';
import { issueMatchesQuery, parseQuery } from './query';
import { queryContext } from './query-context';

export interface VisibleArgs {
  issues: Issue[];
  tab: TabKey;
  filters: Filters;
  sort: SortKey;
  scope?: IssueScope | null;
}

export function selectVisibleIssues({ issues, tab, filters, sort, scope }: VisibleArgs): Issue[] {
  let list = issues;

  if (scope?.mineId) {
    list = list.filter((i) => i.assigneeId === scope.mineId || i.creatorId === scope.mineId);
  }
  if (scope?.status?.length) list = list.filter((i) => scope.status!.includes(i.status));

  if (tab === 'active') list = list.filter((i) => i.status === 'in_progress' || i.status === 'in_review');
  if (tab === 'backlog') list = list.filter((i) => i.status === 'backlog' || i.status === 'todo');

  if (filters.status.length) list = list.filter((i) => filters.status.includes(i.status));
  if (filters.priority.length) list = list.filter((i) => filters.priority.includes(i.priority));
  if (filters.assigneeId.length)
    list = list.filter((i) => i.assigneeId && filters.assigneeId.includes(i.assigneeId));
  if (filters.labelIds.length)
    list = list.filter((i) => i.labelIds.some((l) => filters.labelIds.includes(l)));

  if (filters.due !== 'any') {
    const now = Date.now();
    const week = now + 7 * 86_400_000;
    list = list.filter((issue) => {
      if (filters.due === 'no_date') return !issue.dueDate;
      if (!issue.dueDate) return false;
      const at = +new Date(issue.dueDate);
      if (Number.isNaN(at)) return false;
      if (filters.due === 'overdue') return at < now;
      return at >= now && at <= week;
    });
  }

  if (filters.query.trim()) {
    // The same grammar the search page uses: `status:todo assignee:me` filters,
    // plain words still search titles and keys.
    const parsed = parseQuery(filters.query);
    if (parsed.terms.length || parsed.text.length) {
      const context = queryContext();
      list = list.filter((issue) => issueMatchesQuery(issue, parsed, context));
    }
  }

  return sortIssues(list, sort);
}

export function countActiveFilters(filters: Filters) {
  return (
    filters.status.length +
    filters.priority.length +
    filters.assigneeId.length +
    filters.labelIds.length +
    (filters.due !== 'any' ? 1 : 0) +
    (filters.query.trim() ? 1 : 0)
  );
}

/** Progress of a project, derived from its issues (the stored field cannot be trusted). */
export function projectProgress(issues: Issue[], projectId: string) {
  const rows = issues.filter((issue) => issue.projectId === projectId);
  const closed = rows.filter((issue) => issue.status === 'canceled' || issue.status === 'duplicate').length;
  const done = rows.filter((issue) => issue.status === 'done').length;
  return { total: rows.length, done, ratio: rows.length ? done / Math.max(1, rows.length - closed) : 0 };
}
