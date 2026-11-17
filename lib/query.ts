import type { Issue, Priority, StatusKey } from './types';

/**
 * The filter query language, Linear-style.
 *
 *   status:todo,in_progress  assignee:me  label:Bug  -priority:low
 *   cycle:c43  project:atlas  due:overdue  is:unassigned  "exact phrase"
 *
 * Plain words still search the title and key, so the box keeps working the way
 * people expect; anything that looks like `key:value` is parsed, and a value
 * with spaces can be quoted. Everything is pure so the regression harness can
 * hold the grammar still.
 */

const STATUS_ALIASES: Record<string, StatusKey> = {
  backlog: 'backlog',
  todo: 'todo',
  'to-do': 'todo',
  'in-progress': 'in_progress',
  'in progress': 'in_progress',
  progress: 'in_progress',
  started: 'in_progress',
  'in-review': 'in_review',
  'in review': 'in_review',
  review: 'in_review',
  done: 'done',
  completed: 'done',
  canceled: 'canceled',
  cancelled: 'canceled',
  duplicate: 'duplicate',
  dup: 'duplicate',
};

const PRIORITIES: Record<string, Priority> = {
  none: 'none',
  no: 'none',
  urgent: 'urgent',
  p0: 'urgent',
  high: 'high',
  p1: 'high',
  medium: 'medium',
  med: 'medium',
  p2: 'medium',
  low: 'low',
  p3: 'low',
};

const DUE = new Set(['overdue', 'week', 'today', 'none', 'any']);
const KEYS = new Set(['status', 'priority', 'assignee', 'label', 'cycle', 'project', 'due', 'is']);

export interface QueryTerm {
  key: string;
  values: string[];
  negated: boolean;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  /** free words that search title and key */
  text: string[];
  /** tokens that looked like `key:value` but used an unknown key */
  unknown: string[];
}

/** Split on whitespace, but keep `"quoted values"` (and `key:"a b"`) intact. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

const unquote = (value: string) => value.replace(/^"|"$/g, '').trim();

export function parseQuery(input: string): ParsedQuery {
  const terms: QueryTerm[] = [];
  const text: string[] = [];
  const unknown: string[] = [];

  for (const token of tokenize(input)) {
    const negated = token.startsWith('-') && token.length > 1;
    const body = negated ? token.slice(1) : token;
    const at = body.indexOf(':');
    if (at <= 0) {
      const phrase = unquote(body).toLowerCase();
      if (phrase) text.push(phrase);
      continue;
    }
    const key = body.slice(0, at).toLowerCase();
    const rawValue = body.slice(at + 1);
    if (!KEYS.has(key) || !rawValue) {
      const phrase = unquote(body).toLowerCase();
      if (phrase) text.push(phrase);
      if (!KEYS.has(key)) unknown.push(key);
      continue;
    }
    const values = rawValue
      .split(',')
      .map(unquote)
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    if (!values.length) continue;
    terms.push({ key, values, negated });
  }

  return { terms, text, unknown };
}

export interface QueryContext {
  /** resolves `assignee:me`; without it that value never matches */
  meId?: string | null;
  now?: number;
  personName?: (id: string) => string | undefined;
  labelName?: (id: string) => string | undefined;
  projectName?: (id: string) => string | undefined;
  cycleName?: (id: string) => string | undefined;
}

function normalizeStatus(value: string): StatusKey | null {
  return STATUS_ALIASES[value] ?? null;
}

function normalizePriority(value: string): Priority | null {
  return PRIORITIES[value] ?? null;
}

function labelMatches(issue: Issue, value: string, ctx: QueryContext): boolean {
  return issue.labelIds.some((id) => {
    if (id.toLowerCase() === value) return true;
    const name = ctx.labelName?.(id);
    return Boolean(name && name.toLowerCase() === value);
  });
}

function personMatches(issue: Issue, value: string, ctx: QueryContext): boolean {
  if (!issue.assigneeId) return value === 'none' || value === 'unassigned';
  if (value === 'none' || value === 'unassigned') return false;
  if (value === 'me') return Boolean(ctx.meId) && issue.assigneeId === ctx.meId;
  if (issue.assigneeId.toLowerCase() === value) return true;
  const name = ctx.personName?.(issue.assigneeId);
  return Boolean(name && name.toLowerCase() === value);
}

function dueMatches(issue: Issue, value: string, now: number): boolean {
  if (value === 'none') return !issue.dueDate;
  if (value === 'any') return true;
  if (!issue.dueDate) return false;
  const at = +new Date(issue.dueDate);
  if (Number.isNaN(at)) return false;
  if (value === 'overdue') return at < now;
  if (value === 'today') {
    const day = new Date(now);
    const due = new Date(at);
    return (
      due.getFullYear() === day.getFullYear() && due.getMonth() === day.getMonth() && due.getDate() === day.getDate()
    );
  }
  // week
  return at >= now && at <= now + 7 * 86_400_000;
}

function termMatches(issue: Issue, term: QueryTerm, ctx: QueryContext): boolean {
  const now = ctx.now ?? Date.now();
  switch (term.key) {
    case 'status':
      return term.values.some((value) => normalizeStatus(value) === issue.status);
    case 'priority':
      return term.values.some((value) => normalizePriority(value) === issue.priority);
    case 'assignee':
      return term.values.some((value) => personMatches(issue, value, ctx));
    case 'label':
      return term.values.some((value) => labelMatches(issue, value, ctx));
    case 'cycle':
      if (!issue.cycleId) return term.values.includes('none');
      return term.values.some(
        (value) => issue.cycleId?.toLowerCase() === value || ctx.cycleName?.(issue.cycleId!)?.toLowerCase() === value,
      );
    case 'project':
      if (!issue.projectId) return term.values.includes('none');
      return term.values.some(
        (value) =>
          issue.projectId?.toLowerCase() === value || ctx.projectName?.(issue.projectId!)?.toLowerCase() === value,
      );
    case 'due':
      return term.values.some((value) => (DUE.has(value) ? dueMatches(issue, value, now) : false));
    case 'is': {
      return term.values.some((value) => {
        if (value === 'unassigned') return !issue.assigneeId;
        if (value === 'assigned') return Boolean(issue.assigneeId);
        if (value === 'overdue') return dueMatches(issue, 'overdue', now);
        if (value === 'open') return issue.status !== 'done' && issue.status !== 'canceled';
        if (value === 'done') return issue.status === 'done';
        return false;
      });
    }
    default:
      return false;
  }
}

/** Every term and every free word must pass; a negated term only has to fail. */
export function issueMatchesQuery(issue: Issue, parsed: ParsedQuery, ctx: QueryContext = {}): boolean {
  if (!parsed.terms.length && !parsed.text.length) return true;

  for (const term of parsed.terms) {
    const hit = termMatches(issue, term, ctx);
    if (term.negated ? hit : !hit) return false;
  }

  if (parsed.text.length) {
    const haystack = `${issue.key} ${issue.title} ${issue.description ?? ''}`.toLowerCase();
    for (const word of parsed.text) {
      if (!haystack.includes(word)) return false;
    }
  }

  return true;
}

/** Human summary of the parsed filters, for a hint under the search box. */
export function describeQuery(parsed: ParsedQuery): string[] {
  const parts = parsed.terms.map((term) => `${term.negated ? '-' : ''}${term.key}:${term.values.join(',')}`);
  if (parsed.text.length) parts.push(`“${parsed.text.join(' ')}”`);
  return parts;
}
