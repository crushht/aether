import { inAuditRange, type AuditRange } from './audit-range';

/**
 * Authentication events as an append-only audit trail.
 *
 * Project updates already carry their own audit (`Project.updateAudit`), but the
 * door to the workspace — sign-in, mailed codes, password resets, session
 * revocation — left no trace anywhere. These events are what an owner needs when
 * something looks wrong: who got in, from which address, with which browser, and
 * what was refused.
 *
 * Two rules shape the record:
 *   - an address is stored masked (`a***@example.com`); the audit is not a
 *     second copy of the account table;
 *   - the reason is a short sentence, not a payload — no passwords, no codes, no
 *     cookies ever reach this file.
 *
 * Everything here is pure: the file I/O lives in `lib/server/security-audit.ts`.
 */

export type SecurityEventKind =
  | 'sign_in'
  | 'sign_out'
  | 'code'
  | 'password_change'
  | 'password_reset'
  | 'register'
  | 'session_revoke';

export const SECURITY_EVENT_KINDS: readonly SecurityEventKind[] = [
  'sign_in',
  'sign_out',
  'code',
  'password_change',
  'password_reset',
  'register',
  'session_revoke',
];

/** A filter chip in the UI; every kind belongs to exactly one group. */
export type SecurityEventGroup = 'sign_in' | 'password' | 'code' | 'account';

export type SecurityEventFilter = 'all' | SecurityEventGroup;

export const SECURITY_EVENT_FILTERS: readonly SecurityEventFilter[] = [
  'all',
  'sign_in',
  'password',
  'code',
  'account',
];

const GROUP_OF: Record<SecurityEventKind, SecurityEventGroup> = {
  sign_in: 'sign_in',
  sign_out: 'sign_in',
  code: 'code',
  password_change: 'password',
  password_reset: 'password',
  register: 'account',
  session_revoke: 'account',
};

export function groupOfKind(kind: SecurityEventKind): SecurityEventGroup {
  return GROUP_OF[kind];
}

export interface SecurityAuditEvent {
  id: string;
  /** ISO timestamp */
  at: string;
  kind: SecurityEventKind;
  /** false means the attempt was refused (wrong password, expired code, …) */
  ok: boolean;
  /** empty when the email has no account here — the refusal is still recorded */
  actorId: string;
  actorName: string;
  /** masked, e.g. `a***@example.com` */
  actorEmail: string;
  ip: string;
  ua: string;
  /** one short line: which method, or why it was refused */
  detail: string;
}

export interface SecurityAuditInput {
  kind: SecurityEventKind;
  ok: boolean;
  at?: string | number;
  id?: string;
  actorId?: string;
  actorName?: string;
  actorEmail?: string;
  ip?: string;
  ua?: string;
  detail?: string;
}

const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** One clean line: no control characters, no newlines, bounded length. */
export function auditText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * `alice@example.com` → `a***@example.com`. A local part of one character keeps
 * its single character; a value with no `@` keeps only its first character.
 */
export function maskEmail(value: unknown): string {
  const email = auditText(value, 120).toLowerCase();
  if (!email) return '';
  const at = email.lastIndexOf('@');
  if (at <= 0) return `${email.slice(0, 1)}***`;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`.slice(0, 120);
}

function stampOf(value: string | number | undefined, now: number): number {
  if (value === undefined) return now;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** A stable id when the caller has none: same event, same id, on every read. */
function fallbackId(kind: SecurityEventKind, at: number): string {
  const iso = new Date(at).toISOString().replace(/[-:]/g, '').replace(/\..*$/, 'Z');
  return `ev_${iso}_${kind}`;
}

/**
 * The single gate every event passes through, whether it arrives from a route
 * handler or from a line read off disk. Anything unrecognisable is dropped
 * instead of being shown half-built.
 */
export function normalizeSecurityEvent(
  input: Partial<SecurityAuditInput> | null | undefined,
  now: number = Date.now(),
): SecurityAuditEvent | null {
  if (!input || typeof input !== 'object') return null;
  const kind = input.kind;
  if (typeof kind !== 'string' || !SECURITY_EVENT_KINDS.includes(kind as SecurityEventKind)) return null;

  const at = stampOf(input.at, now);
  if (!Number.isFinite(at) || at <= 0) return null;

  return {
    id: auditText(input.id, 60) || fallbackId(kind as SecurityEventKind, at),
    at: new Date(at).toISOString(),
    kind: kind as SecurityEventKind,
    ok: input.ok !== false,
    actorId: auditText(input.actorId, 60),
    actorName: auditText(input.actorName, 80),
    actorEmail: maskEmail(input.actorEmail),
    ip: auditText(input.ip, 80),
    ua: auditText(input.ua, 300),
    detail: auditText(input.detail, 200),
  };
}

export function securityAuditLine(event: SecurityAuditEvent): string {
  return JSON.stringify(event);
}

const timeOf = (event: SecurityAuditEvent) => Date.parse(event.at) || 0;

/** Newest first, ties broken by id so two reads of the same file agree. */
function newestFirst(a: SecurityAuditEvent, b: SecurityAuditEvent): number {
  const delta = timeOf(b) - timeOf(a);
  return delta === 0 ? a.id.localeCompare(b.id) : delta;
}

/** Chronological — the order lines are appended in. */
function oldestFirst(a: SecurityAuditEvent, b: SecurityAuditEvent): number {
  return -newestFirst(a, b);
}

export function sortSecurityEvents(events: readonly SecurityAuditEvent[]): SecurityAuditEvent[] {
  return [...events].sort(newestFirst);
}

/** JSONL on disk → events, skipping blank, broken or duplicate lines. */
export function parseSecurityAudit(text: string): SecurityAuditEvent[] {
  const out: SecurityAuditEvent[] = [];
  const seen = new Set<string>();
  for (const line of (text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = normalizeSecurityEvent(parsed as Partial<SecurityAuditInput>);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out.sort(newestFirst);
}

/** Keep the newest `max` events (input order does not matter). */
export function capSecurityEvents(events: readonly SecurityAuditEvent[], max = 600): SecurityAuditEvent[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  return sortSecurityEvents(events).slice(0, Math.floor(max));
}

/** The file is append-only; when it is trimmed we rewrite it oldest-first. */
export function securityAuditFileBody(events: readonly SecurityAuditEvent[], max = 600): string {
  const kept = capSecurityEvents(events, max).sort(oldestFirst);
  return kept.length ? `${kept.map(securityAuditLine).join('\n')}\n` : '';
}

export interface SecurityAuditQuery {
  group?: SecurityEventFilter | null;
  range?: AuditRange | null;
  /** only refused attempts */
  failuresOnly?: boolean;
  /** one account only — used for members, who never see anyone else */
  actorId?: string | null;
  needle?: string;
  limit?: number;
}

const MAX_LIMIT = 500;

export function filterSecurityAudit(
  events: readonly SecurityAuditEvent[],
  query: SecurityAuditQuery = {},
  now: Date = new Date(),
): SecurityAuditEvent[] {
  const group = query.group && SECURITY_EVENT_FILTERS.includes(query.group) ? query.group : 'all';
  const range: AuditRange = query.range ?? 'all';
  const actorId = auditText(query.actorId, 60);
  const needle = auditText(query.needle, 120).toLowerCase();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(query.limit) || MAX_LIMIT)));

  const matched = events.filter((event) => {
    if (group !== 'all' && GROUP_OF[event.kind] !== group) return false;
    if (query.failuresOnly && event.ok) return false;
    if (actorId && event.actorId !== actorId) return false;
    if (!inAuditRange(event.at, range, now)) return false;
    if (needle) {
      const haystack = `${event.kind} ${event.actorName} ${event.actorEmail} ${event.ip} ${event.detail}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  return sortSecurityEvents(matched).slice(0, limit);
}

export interface SecurityAuditViewer {
  id?: string;
  role?: string;
}

/**
 * An owner sees the whole trail. A member sees only the events attributed to
 * their own account — a refused sign-in for an address with no account never
 * belongs to a member, so it stays with the owner.
 */
export function securityAuditVisibleTo(
  event: SecurityAuditEvent,
  viewer: SecurityAuditViewer | null | undefined,
): boolean {
  if (!viewer || typeof viewer !== 'object') return false;
  if (viewer.role === 'owner') return true;
  return Boolean(viewer.id) && event.actorId === viewer.id;
}

export function visibleSecurityEvents(
  events: readonly SecurityAuditEvent[],
  viewer: SecurityAuditViewer | null | undefined,
): SecurityAuditEvent[] {
  return events.filter((event) => securityAuditVisibleTo(event, viewer));
}

export interface SecurityAuditSummary {
  total: number;
  /** since local midnight */
  today: number;
  /** refused attempts in the last 24 hours */
  failures: number;
  lastAt: string | null;
  byGroup: Record<SecurityEventFilter, number>;
}

export function securityAuditSummary(
  events: readonly SecurityAuditEvent[],
  now: Date = new Date(),
): SecurityAuditSummary {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const dayAgo = now.getTime() - 86_400_000;

  const byGroup: Record<SecurityEventFilter, number> = {
    all: events.length,
    sign_in: 0,
    password: 0,
    code: 0,
    account: 0,
  };
  let today = 0;
  let failures = 0;
  let lastAt: string | null = null;
  let lastTime = 0;

  for (const event of events) {
    byGroup[GROUP_OF[event.kind]] += 1;
    const time = timeOf(event);
    if (time >= dayStart) today += 1;
    if (!event.ok && time >= dayAgo) failures += 1;
    if (time > lastTime) {
      lastTime = time;
      lastAt = event.at;
    }
  }

  return { total: events.length, today, failures, lastAt, byGroup };
}

const cell = (value: string) => auditText(value, 300).replace(/\|/g, '\\|');

function localStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface SecurityAuditExportMeta {
  /** who is exporting, for the header */
  viewer?: string;
  /** 'all' for an owner, 'self' for a member */
  scope?: 'all' | 'self';
  /** the filter chips in force, already human readable */
  filter?: string;
  now?: Date;
}

/** Markdown for the clipboard or a ticket — the same rows the panel shows. */
export function securityAuditMarkdown(
  events: readonly SecurityAuditEvent[],
  meta: SecurityAuditExportMeta = {},
): string {
  const now = meta.now ?? new Date();
  const lines = [
    '# Aether security audit',
    '',
    `- exported: ${localStamp(now)}`,
    `- scope: ${meta.scope === 'self' ? 'your events only' : 'whole workspace'}`,
    ...(meta.viewer ? [`- exported by: ${cell(meta.viewer)}`] : []),
    `- filter: ${cell(meta.filter ?? 'all')}`,
    `- events: ${events.length}`,
    '',
  ];

  if (!events.length) {
    lines.push('No events match this filter.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| when | event | result | who | ip | device | detail |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const event of events) {
    const at = new Date(event.at);
    lines.push(
      `| ${Number.isFinite(at.getTime()) ? localStamp(at) : cell(event.at)} | ${event.kind} | ${
        event.ok ? 'ok' : 'refused'
      } | ${cell(event.actorName || event.actorEmail || '—')} | ${cell(event.ip || '—')} | ${cell(
        event.ua ? event.ua.slice(0, 60) : '—',
      )} | ${cell(event.detail || '—')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function securityAuditFileName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `aether-security-audit-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
}
