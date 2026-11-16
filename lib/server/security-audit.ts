import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  capSecurityEvents,
  normalizeSecurityEvent,
  parseSecurityAudit,
  securityAuditFileBody,
  securityAuditLine,
  type SecurityAuditEvent,
  type SecurityAuditInput,
} from '@/lib/security-audit';
import { filePath, withLock, writeText } from './store';

/**
 * Where authentication events land: one append-only JSONL file next to the
 * workspace snapshot.
 *
 * It is deliberately *not* part of `workspace.json`. The client writes that
 * snapshot whole, so a server-side append would be erased by the next issue edit
 * — the audit has to live somewhere a client never rewrites.
 *
 * Writes are best effort: an audit file that cannot be written must never turn a
 * working sign-in into a failure. Reads are tolerant in the same way — a torn
 * line is skipped, not fatal.
 */

const FILE = 'security-audit.jsonl';
/** Keep the tail bounded: a busy instance should not grow this file forever. */
const MAX_EVENTS = 600;
const MAX_BYTES = 512 * 1024;

/** Appends one event. Never throws, never answers anything to the caller. */
export async function recordSecurityEvent(input: SecurityAuditInput): Promise<void> {
  const event = normalizeSecurityEvent(input);
  if (!event) return;
  try {
    await withLock(FILE, async () => {
      const target = filePath(FILE);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.appendFile(target, `${securityAuditLine(event)}\n`, 'utf8');

      const { size } = await fs.stat(target);
      if (size <= MAX_BYTES) return;
      const text = await fs.readFile(target, 'utf8');
      await writeText(FILE, securityAuditFileBody(parseSecurityAudit(text), MAX_EVENTS));
    });
  } catch {
    /* the sign-in goes on; the trail silently misses one line */
  }
}

/** Every stored event, newest first. */
export async function readSecurityAudit(): Promise<SecurityAuditEvent[]> {
  let text = '';
  try {
    text = await fs.readFile(filePath(FILE), 'utf8');
  } catch {
    return [];
  }
  return capSecurityEvents(parseSecurityAudit(text), MAX_EVENTS);
}
