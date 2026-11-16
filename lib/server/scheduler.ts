import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, filePath, readJson, withLock, writeJson } from './store';
import { readAether } from './aether';
import { runWorkflowOnServer, workflowDue } from './agent-run';

/**
 * Headless workflow scheduler.
 *
 * One pass per minute over every account profile. A run is claimed in memory so
 * two ticks cannot overlap; `lastRunAt` on the workflow is the durable guard.
 * Instances coordinate through a lease file so a second node does not fire the
 * same window twice.
 */

const running = new Set<string>();
const STARTED_KEY = '__aetherSchedulerStarted';

/**
 * Route handlers and the server layout may end up with separate module
 * instances of this file, so the observable state lives on globalThis.
 */
type SchedulerState = { started: boolean; lastTickAt: number | null };
const globalState = globalThis as unknown as { __aetherSchedulerState?: SchedulerState };
const state: SchedulerState = (globalState.__aetherSchedulerState ??= { started: false, lastTickAt: null });

const OWNER = `${process.env.HOSTNAME ?? 'host'}:${process.pid}`;
const LEASE_FILE = 'scheduler.lock';
const LEASE_MS = 75_000;

/** Renew the lease for this instance; false means another node owns the window.
 *  The create is `wx` (exclusive) so two processes cannot both win, and an
 *  expired lease is reclaimed once. */
async function acquireLease() {
  return withLock(LEASE_FILE, async () => {
    const now = Date.now();
    const lockPath = filePath(LEASE_FILE);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ owner: OWNER, at: now }), 'utf8');
        await handle.close();
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
        const current = await readJson<{ owner: string; at: number }>(LEASE_FILE, { owner: '', at: 0 });
        if (current.owner === OWNER) {
          await writeJson(LEASE_FILE, { owner: OWNER, at: now });
          return true;
        }
        if (current.owner && now - current.at < LEASE_MS) return false;
        // stale lease: remove it and race for the create exactly once more
        await fs.unlink(lockPath).catch(() => undefined);
      }
    }
    return false;
  });
}

async function runDue() {
  state.lastTickAt = Date.now();
  if (!(await acquireLease())) return;

  const dir = path.join(DATA_DIR, 'aether');
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json'));
  } catch {
    return;
  }

  const now = new Date();
  for (const file of files) {
    const accountId = file.replace(/\.json$/, '');
    try {
      const store = await readAether(accountId);
      const due = store.workflows.filter((workflow) => workflowDue(workflow, now));
      for (const workflow of due) {
        const claim = `${accountId}:${workflow.id}`;
        if (running.has(claim)) continue;
        running.add(claim);
        try {
          const run = await runWorkflowOnServer(accountId, workflow);
          if (run) {
            console.log(
              `[aether] workflow "${workflow.name}" (${accountId}) → ${run.status}${
                run.issueKey ? ` · ${run.issueKey}` : ''
              }`,
            );
          }
        } catch (error) {
          console.error('[aether] workflow failed', workflow.id, error);
          // a failed attempt still advances lastRunAt, so it is not retried in a loop
        } finally {
          running.delete(claim);
        }
      }
    } catch (error) {
      console.error('[aether] scheduler could not read', accountId, error);
    }
  }
}

/** Called once per server process. Hot reload resets module state, so the flag
 * lives on globalThis as well; otherwise dev registers two intervals. */
export function startServerScheduler() {
  if (state.started) return;
  state.started = true;
  const globals = globalThis as unknown as Record<string, boolean>;
  globals[STARTED_KEY] = true;
  setTimeout(() => void runDue(), 8_000);
  setInterval(() => void runDue(), 60_000);
  console.log('[aether] workflow scheduler started');
}

export { runDue as runSchedulerNow };

export function schedulerStatus() {
  return {
    started: state.started,
    lastTickAt: state.lastTickAt,
    running: running.size,
    disabled: process.env.AETHER_SCHEDULER === '0',
  };
}
