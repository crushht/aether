/**
 * Gate reporting for `scripts/autopilot.mjs --check` — the PR gate.
 *
 * Pure on purpose: no fs, no clock, no network. Everything that decides *what a
 * gate run means* lives here, so regression can pin it down:
 *
 * - which gates were asked for (and which names are typos),
 * - how much of a gate's output is worth keeping,
 * - which gate failed, and which ones never got to run,
 * - whether the failing tree should be stashed,
 * - what the CI summary and the JSON artifact say.
 *
 * The report is written in English: it is a build artefact read in CI logs and
 * the GitHub step summary, not UI copy.
 */

/** The gates `scripts/autopilot.mjs` actually knows how to run. */
export const KNOWN_GATES = ['typecheck', 'regression', 'build', 'i18n'] as const;

/** Default `--gates` list: what a PR must pass in under two minutes. */
export const DEFAULT_GATES = ['typecheck', 'regression'] as const;

/** How many trailing output lines survive into a report. */
export const GATE_TAIL_LINES = 12;

/** Hard cap per tail: one pathological compiler line cannot bloat the summary. */
export const GATE_TAIL_CHARS = 2_000;

export type StashReason = 'ok' | 'disabled' | 'not-failed' | 'clean-tree' | 'failed';

export interface GateResult {
  name: string;
  ok: boolean;
  code: number;
  tail: string;
}

export interface GateSelection {
  /** Normalised, de-duplicated gate names in run order. */
  planned: string[];
  /** Planned names this driver cannot run — a typo, never a silent pass. */
  unknown: string[];
}

export interface GateSummary {
  ok: boolean;
  /** Planned gates that produced a passing result. */
  passed: string[];
  /** Planned gates that ran and failed (unknown gate names land here too). */
  failed: GateResult[];
  /** Planned gates that never ran, because an earlier gate stopped the run. */
  skipped: string[];
  /** Results for gates nobody asked for. */
  extra: GateResult[];
  total: number;
}

export interface GateLogRef {
  name: string;
  /** Repo-relative path, forward slashes, so the artifact layout is portable. */
  file: string;
  bytes: number;
}

export interface StashOutcome {
  attempted: boolean;
  created: boolean;
  reason: StashReason;
  /** `stash@{0}` plus its short hash once it exists. */
  ref: string;
  message: string;
}

export interface GateReportMeta {
  branch?: string;
  commit?: string;
  /** Tree state *before* any stash — that is what the reader wants to know. */
  dirty?: boolean;
  node?: string;
}

export interface GateReport {
  version: 1;
  at: string;
  branch: string;
  commit: string;
  dirty: boolean;
  node: string;
  planned: string[];
  summary: GateSummary;
  results: GateResult[];
  logs: GateLogRef[];
  stash: StashOutcome | null;
}

/* ------------------------------------------------------------------ naming */

/**
 * A gate name becomes a filename (`gate-<name>.log`) and a table cell, so it
 * must not be able to walk out of the log directory or break a markdown table.
 * Returns `''` when nothing usable is left — the callers drop those entries.
 */
function cleanGateName(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 40);
}

/** Same, with a display fallback for "somebody passed nonsense". */
export function safeGateName(name: unknown): string {
  return cleanGateName(name) || 'gate';
}

/** `2026-11-16T10:20:30.123Z` → `2026-11-16 10:20:30`; never empty. */
export function normalizeStamp(at: unknown): string {
  const raw = String(at ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(raw);
  if (match) return `${match[1]} ${match[2]}`;
  if (raw) return raw.slice(0, 19);
  return 'unknown time';
}

/* ---------------------------------------------------------------- selection */

/**
 * `--gates typecheck, Regression ,,build` → run order preserved, duplicates and
 * blanks dropped, case folded, unknown names reported instead of ignored.
 */
export function parseGates(spec: unknown, fallback: readonly string[] = DEFAULT_GATES): GateSelection {
  const requested = String(spec ?? '')
    .split(',')
    .map((name) => cleanGateName(name))
    .filter(Boolean);
  const source = requested.length ? requested : fallback.map((name) => cleanGateName(name)).filter(Boolean);
  const planned: string[] = [];
  for (const name of source) if (!planned.includes(name)) planned.push(name);
  return {
    planned,
    unknown: planned.filter((name) => !(KNOWN_GATES as readonly string[]).includes(name)),
  };
}

/* ------------------------------------------------------------------- output */

/** Last `limit` lines, control-character free, clipped from the front. */
export function tailOf(output: unknown, limit: number = GATE_TAIL_LINES): string {
  const text = String(output ?? '')
    .replace(/\r\n?/g, '\n')
    // Keep the report readable: colour codes and stray NULs are noise in a log.
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\u0000/g, '')
    .replace(/^\n+/, '')
    .trimEnd();
  if (!text.trim()) return '';
  const lines = Math.max(1, Math.trunc(limit) || GATE_TAIL_LINES);
  const tail = text.split('\n').slice(-lines).join('\n').trimEnd();
  return tail.length > GATE_TAIL_CHARS ? `...${tail.slice(-GATE_TAIL_CHARS)}` : tail;
}

/**
 * Gate results come back from the driver, but also from a stale `.improve`
 * state file: normalise, de-duplicate by name and drop anything unusable.
 */
export function normalizeGateResults(input: unknown): GateResult[] {
  if (!Array.isArray(input)) return [];
  const results: GateResult[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = cleanGateName(typeof row.name === 'string' ? row.name : '');
    if (!name || results.some((result) => result.name === name)) continue;
    const ok = row.ok === true;
    const code =
      typeof row.code === 'number' && Number.isFinite(row.code) ? Math.trunc(row.code) : ok ? 0 : 1;
    results.push({ name, ok, code, tail: tailOf(row.tail) });
  }
  return results;
}

/* ------------------------------------------------------------------ verdict */

/**
 * A planned gate with no result is *skipped*, not passed: the driver stops at
 * the first failure, and a summary that hides that would be a lie.
 */
export function summarizeGates(planned: readonly string[], results: unknown): GateSummary {
  const rows = normalizeGateResults(results);
  const names: string[] = [];
  for (const name of planned ?? []) {
    const clean = cleanGateName(name);
    if (clean && !names.includes(clean)) names.push(clean);
  }
  const byName = new Map(rows.map((row) => [row.name, row] as const));
  const passed: string[] = [];
  const failed: GateResult[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const row = byName.get(name);
    if (!row) skipped.push(name);
    else if (row.ok) passed.push(name);
    else failed.push(row);
  }
  const extra = rows.filter((row) => !names.includes(row.name));
  return {
    ok: names.length > 0 && failed.length === 0 && skipped.length === 0,
    passed,
    failed,
    skipped,
    extra,
    total: names.length,
  };
}

/** 0 when the run may merge, 1 otherwise. Unknown-only runs never pass. */
export function exitCodeFor(report: Pick<GateReport, 'summary'> | null | undefined): number {
  return report?.summary?.ok ? 0 : 1;
}

/* -------------------------------------------------------------------- stash */

/**
 * Stash only when it can help: the gate failed *and* there is something in the
 * tree. A clean tree in CI is the normal case, and `git stash` there would
 * either fail or stash somebody else's work.
 */
export function stashPlan(input: { enabled: boolean; failed: boolean; dirty: boolean }): {
  run: boolean;
  reason: StashReason;
} {
  if (!input.enabled) return { run: false, reason: 'disabled' };
  if (!input.failed) return { run: false, reason: 'not-failed' };
  if (!input.dirty) return { run: false, reason: 'clean-tree' };
  return { run: true, reason: 'ok' };
}

/** One line a person can read six months later in `git stash list`. */
export function stashMessage(input: { failed?: string | null; at?: unknown }): string {
  const who = safeGateName(input?.failed ?? 'gate');
  return `autopilot gate failed: ${who} @ ${normalizeStamp(input?.at)}`;
}

/* ------------------------------------------------------------------- report */

export function normalizeReport(input: {
  at?: unknown;
  planned?: readonly string[];
  results?: unknown;
  logs?: unknown;
  stash?: StashOutcome | null;
  meta?: GateReportMeta;
}): GateReport {
  const planned: string[] = [];
  for (const name of input?.planned ?? []) {
    const clean = cleanGateName(name);
    if (clean && !planned.includes(clean)) planned.push(clean);
  }
  const results = normalizeGateResults(input?.results);
  const logs: GateLogRef[] = [];
  for (const entry of Array.isArray(input?.logs) ? input.logs : []) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = safeGateName(typeof row.name === 'string' ? row.name : '');
    const file =
      typeof row.file === 'string' ? row.file.replace(/\\/g, '/').replace(/^\.\//, '').trim() : '';
    if (!file) continue;
    const bytes = typeof row.bytes === 'number' && Number.isFinite(row.bytes) ? Math.max(0, Math.trunc(row.bytes)) : 0;
    logs.push({ name, file, bytes });
  }
  const meta = input?.meta ?? {};
  return {
    version: 1,
    at: String(input?.at ?? ''),
    branch: String(meta.branch ?? '').trim(),
    commit: String(meta.commit ?? '').trim(),
    dirty: meta.dirty === true,
    node: String(meta.node ?? '').trim(),
    planned,
    summary: summarizeGates(planned, results),
    results,
    logs,
    stash: input?.stash ? normalizeStash(input.stash) : null,
  };
}

function normalizeStash(stash: StashOutcome): StashOutcome {
  const reasons: StashReason[] = ['ok', 'disabled', 'not-failed', 'clean-tree', 'failed'];
  return {
    attempted: stash.attempted === true,
    created: stash.created === true,
    reason: reasons.includes(stash.reason) ? stash.reason : 'failed',
    ref: String(stash.ref ?? '').trim(),
    message: String(stash.message ?? '').trim(),
  };
}

export function gateReportJson(report: GateReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const STASH_TEXT: Record<StashReason, string> = {
  ok: 'working tree stashed',
  disabled: 'not requested (--stash-on-fail off)',
  'not-failed': 'not needed (gate passed)',
  'clean-tree': 'not needed (working tree was clean)',
  failed: 'stash failed, the tree is left as it was',
};

/** The GitHub step summary: short, plain text, no escaping traps. */
export function gateReportMarkdown(report: GateReport): string {
  const { summary } = report;
  const lines: string[] = [];
  lines.push(`## autopilot gate — ${summary.ok ? 'passed' : 'failed'}`);
  lines.push('');
  lines.push(`- when: ${normalizeStamp(report.at)}`);
  const where = [report.branch ? `branch \`${report.branch}\`` : '', report.commit ? `commit \`${report.commit}\`` : '']
    .filter(Boolean)
    .join(' · ');
  if (where) lines.push(`- ${where}${report.dirty ? ' · working tree dirty' : ''}`);
  lines.push(`- gates: ${report.planned.join(', ') || '(none)'}`);
  lines.push(
    `- result: ${summary.passed.length} passed · ${summary.failed.length} failed · ${summary.skipped.length} not run`,
  );
  if (report.node) lines.push(`- node: ${report.node}`);
  lines.push('');
  lines.push('| gate | result | exit |');
  lines.push('| --- | --- | --- |');
  const byName = new Map(report.results.map((row) => [row.name, row] as const));
  for (const name of report.planned) {
    const row = byName.get(name);
    if (!row) lines.push(`| ${name} | not run | — |`);
    else lines.push(`| ${name} | ${row.ok ? 'pass' : 'FAIL'} | ${row.code} |`);
  }
  for (const row of summary.extra) lines.push(`| ${row.name} | ${row.ok ? 'pass' : 'FAIL'} (unplanned) | ${row.code} |`);

  for (const row of report.results.filter((entry) => !entry.ok)) {
    lines.push('');
    lines.push(`### ${row.name} (exit ${row.code})`);
    lines.push('');
    if (!row.tail) {
      lines.push('    (no output captured)');
      continue;
    }
    // Indented, not fenced: gate output can itself contain a ``` line.
    for (const line of row.tail.split('\n')) lines.push(`    ${line}`);
  }

  if (report.stash) {
    lines.push('');
    lines.push('### stash');
    lines.push('');
    const detail = STASH_TEXT[report.stash.reason];
    if (report.stash.created && report.stash.ref) {
      lines.push(`- ${detail}: \`${report.stash.ref}\``);
    } else {
      lines.push(`- ${detail}`);
    }
    if (report.stash.message) lines.push(`- message: \`${report.stash.message}\``);
  }

  if (report.logs.length) {
    lines.push('');
    lines.push('### logs');
    lines.push('');
    for (const log of report.logs) lines.push(`- \`${log.file}\` (${log.bytes} bytes)`);
  }
  lines.push('');
  return lines.join('\n');
}
