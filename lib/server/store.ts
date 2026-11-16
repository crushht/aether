import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Every piece of server state lives in one directory so a backup is a copy:
 *
 *   .data/
 *     secret.key            encryption material for stored provider keys
 *     users.json            accounts (scrypt hashes only)
 *     sessions.json         opaque session tokens → account
 *     workspace.json        the shared workspace snapshot
 *     workspaces/<id>.json  per-account snapshots (WORKSPACE_MODE=personal)
 *     prefs/<id>.json       per-account preferences + inbox read state
 *     agent/<id>.json       per-account model configuration
 *     security-audit.jsonl  append-only sign-in / code / password trail
 *     workspace-backups/    periodic snapshots of the workspace file
 *
 * `LAB_DATA_DIR` moves the whole thing (the desktop build points it at the
 * user's app-data directory instead of the install folder).
 */
export const DATA_DIR = process.env.LAB_DATA_DIR ?? path.join(process.cwd(), '.data');

export function filePath(...parts: string[]) {
  return path.join(DATA_DIR, ...parts);
}

const locks = new Map<string, Promise<unknown>>();

/** Read a JSON file, falling back to `fallback` when it is missing or broken. */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath(name), 'utf8');
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Write atomically: a torn write must never replace a good snapshot. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  const target = filePath(name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fs.rename(tmp, target);
}

/** The same atomic swap, for files that are not JSON (append-only logs). */
export async function writeText(name: string, body: string): Promise<void> {
  const target = filePath(name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, target);
}

/**
 * Serialise read-modify-write for one file. Route handlers can run
 * concurrently inside a single Next server process; without this two logins
 * or two workspace writes could drop each other's changes.
 */
export function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const next = previous.then(run, run);
  locks.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}

export async function removeFile(name: string): Promise<void> {
  try {
    await fs.unlink(filePath(name));
  } catch {
    /* already gone */
  }
}
