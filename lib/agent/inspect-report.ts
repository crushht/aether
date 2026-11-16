/**
 * `/api/agent/inspect` answers with a report plus the file's hashes. Two places
 * read that answer — the `inspect_artifact` tool and the issue attachment menu —
 * and both need the same residue: PE / ELF / Mach-O / archive facts turned into
 * readable lines, hashes validated, and everything the file itself claims
 * clipped to what a panel can hold.
 *
 * Pure on purpose: no React, no fetch. A report is attacker-controlled text, so
 * every field is sanitised before it reaches the screen, and the whole mapping
 * is testable without a server or a browser.
 */

import { buildInspectCard, oneLine, type InspectCard } from './tool-cards';

/** Bounds matching the report panel: enough context, never a wall of rows. */
export const REPORT_LIMITS = {
  sections: 10,
  entries: 15,
  /** one rendered structure line */
  line: 300,
  field: 40,
} as const;

export interface InspectSectionRow {
  name?: unknown;
  rawSize?: unknown;
  entropy?: unknown;
}

export interface InspectEntryRow {
  name?: unknown;
  size?: unknown;
}

/** The loose shape of the report the route returns; nothing is trusted. */
export interface InspectReportShape {
  name?: unknown;
  size?: unknown;
  format?: { label?: unknown; id?: unknown; detail?: unknown } | null;
  entropy?: unknown;
  packed?: unknown;
  pe?: { machine?: unknown; subsystem?: unknown; timestamp?: unknown; sections?: unknown } | null;
  elf?: { bits?: unknown; endian?: unknown; machine?: unknown; entry?: unknown } | null;
  macho?: { bits?: unknown; cpu?: unknown; filetype?: unknown } | null;
  zip?: unknown;
  strings?: unknown;
  indicators?: unknown;
  embedded?: unknown;
  hex?: unknown;
  notes?: unknown;
}

export interface InspectResponseShape {
  ok?: unknown;
  error?: unknown;
  hashes?: { sha256?: unknown; sha1?: unknown; md5?: unknown } | null;
  report?: InspectReportShape | null;
}

const field = (value: unknown, max: number = REPORT_LIMITS.field): string =>
  oneLine(typeof value === 'number' ? String(value) : value, max);

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const entropy = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '?';

/**
 * Header, section, entry and archive lines for a report. Nested rows are
 * prefixed with `·` rather than spaces: the card trims leading whitespace, so
 * an indent would silently disappear on the way to the panel.
 */
export function structureLines(report: InspectReportShape | null | undefined): string[] {
  if (!report || typeof report !== 'object') return [];
  const lines: string[] = [];

  const pe = report.pe;
  if (pe && typeof pe === 'object') {
    const sections = Array.isArray(pe.sections) ? (pe.sections as unknown[]) : [];
    lines.push(
      `PE ${field(pe.machine) || 'unknown'} · ${field(pe.subsystem) || 'unknown'} · built ${
        field(pe.timestamp) || 'unknown'
      } · ${sections.length} section(s)`,
    );
    for (const raw of sections.slice(0, REPORT_LIMITS.sections)) {
      const section = (raw && typeof raw === 'object' ? raw : {}) as InspectSectionRow;
      lines.push(
        `· ${field(section.name) || '(unnamed)'} raw=${num(section.rawSize)}B entropy=${entropy(section.entropy)}`,
      );
    }
    if (sections.length > REPORT_LIMITS.sections) {
      lines.push(`· … ${sections.length - REPORT_LIMITS.sections} more`);
    }
  }

  const elf = report.elf;
  if (elf && typeof elf === 'object') {
    lines.push(
      `ELF ${field(elf.bits, 8) || '?'}-bit ${field(elf.endian, 12) || '?'} ${field(elf.machine) || 'unknown'} entry ${
        field(elf.entry) || '?'
      }`,
    );
  }

  const macho = report.macho;
  if (macho && typeof macho === 'object') {
    lines.push(
      `Mach-O ${field(macho.bits, 8) || '?'}-bit ${field(macho.cpu) || 'unknown'} ${field(macho.filetype) || '?'}`,
    );
  }

  const entries = Array.isArray(report.zip) ? (report.zip as unknown[]) : [];
  if (entries.length) {
    lines.push('archive entries:');
    for (const raw of entries.slice(0, REPORT_LIMITS.entries)) {
      const entry = (raw && typeof raw === 'object' ? raw : {}) as InspectEntryRow;
      lines.push(`· ${field(entry.name, 120) || '(unnamed)'} (${num(entry.size)}B)`);
    }
    if (entries.length > REPORT_LIMITS.entries) {
      lines.push(`· … ${entries.length - REPORT_LIMITS.entries} more`);
    }
  }

  return lines.map((line) => line.slice(0, REPORT_LIMITS.line));
}

/**
 * Map a `/api/agent/inspect` answer onto the card the transcript and the
 * attachment panel render. Anything that is not a report yields null, so a
 * failed or stale response can only drop the panel, never render `undefined`.
 */
export function inspectCardFromResponse(payload: unknown): InspectCard | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as InspectResponseShape;
  if (body.ok === false) return null;
  const report = body.report;
  if (!report || typeof report !== 'object') return null;
  // A report with neither a size nor a format is not a report.
  if (typeof report.size !== 'number' && !(report.format && typeof report.format === 'object')) return null;
  return buildInspectCard({
    name: report.name,
    size: report.size,
    format: report.format ?? undefined,
    entropy: report.entropy,
    packed: report.packed,
    hashes: body.hashes ?? undefined,
    structure: structureLines(report),
    indicators: report.indicators,
    embedded: report.embedded,
    notes: report.notes,
    strings: report.strings,
    hex: report.hex,
  });
}

/** The slice of an attachment this module needs; keeps it free of store types. */
export interface InspectSource {
  name?: unknown;
  dataUrl?: unknown;
  text?: unknown;
}

/**
 * Attachment bytes become a request body: images travel as their data URL and
 * text files as text. An attachment that carries neither has nothing to analyse
 * — the caller says so instead of sending an empty artifact.
 */
export function inspectRequestBody(
  file: InspectSource | null | undefined,
): { name: string; base64?: string; text?: string } | null {
  if (!file || typeof file !== 'object') return null;
  const name = oneLine(file.name, 200) || 'artifact';
  if (typeof file.dataUrl === 'string' && file.dataUrl.trim()) return { name, base64: file.dataUrl.trim() };
  if (typeof file.text === 'string' && file.text.length) return { name, text: file.text };
  return null;
}
