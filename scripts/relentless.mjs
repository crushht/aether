#!/usr/bin/env node
/**
 * Relentless: the supervisor that does not stop.
 *
 * `autopilot.mjs` runs one round and exits; this keeps handing it the next
 * round until the queue, the gap list and the deep pool are all empty, and even
 * then it waits instead of quitting. It exists because stopping is the failure
 * mode: a round that produced nothing, a gate that went red, a provider that
 * blinked, a queue that ran dry — each has a policy here, and none of them is
 * "give up".
 *
 *   node scripts/relentless.mjs                       # run until stopped
 *   node scripts/relentless.mjs --patch scripts/headless-local-gateway.yaml
 *   node scripts/relentless.mjs --max-hours 8         # safety valve
 *   node scripts/relentless.mjs --stop-when-dry       # opt in to quitting
 *   node scripts/relentless.mjs --status
 *
 * Policy per autopilot exit code:
 *   0   round finished      -> next round immediately
 *   1   gate failed         -> stash the dirty round, next round
 *   3   lock held           -> wait 60s, retry
 *   4   agent unavailable   -> wait 5 min, retry
 *   5   no progress         -> block that item, next round
 *   124 agent timed out     -> stash, next round
 *   ?   anything else       -> wait 2 min, retry
 * When the queue is empty it seeds from docs/11, then promotes three items from
 * docs/13 into docs/11 and seeds again.
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = {
  dir: path.join(root, '.improve'),
  log: path.join(root, '.improve', 'relentless.log'),
  state: path.join(root, '.improve', 'relentless.json'),
  lock: path.join(root, '.improve', 'relentless.lock'),
  next: path.join(root, 'NEXT.md'),
  gaps: path.join(root, 'docs', '11-产品差距清单.md'),
  pool: path.join(root, 'docs', '13-持续候选池.md'),
};

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const num = (flag, fallback) => {
  const parsed = Number(value(flag, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const patch = value('--patch', 'scripts/headless-local-gateway.yaml');
const maxHours = num('--max-hours', 0);
const stopWhenDry = has('--stop-when-dry');
const startedAt = Date.now();

function log(line) {
  mkdirSync(paths.dir, { recursive: true });
  appendFileSync(paths.log, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
}

function saveState(patchState) {
  mkdirSync(paths.dir, { recursive: true });
  const current = existsSync(paths.state) ? JSON.parse(readFileSync(paths.state, 'utf8')) : {};
  writeFileSync(paths.state, JSON.stringify({ ...current, ...patchState, at: new Date().toISOString() }, null, 2), 'utf8');
}

/** Unchecked items in NEXT.md's `## 待办` only. */
function pending() {
  if (!existsSync(paths.next)) return [];
  const items = [];
  let inQueue = false;
  for (const line of readFileSync(paths.next, 'utf8').split('\n')) {
    if (/^##\s/.test(line)) {
      inQueue = /^##\s*待办/.test(line);
      continue;
    }
    if (!inQueue) continue;
    const match = /^- \[ \] (.+)$/.exec(line.trim());
    if (match) items.push(match[1]);
  }
  return items;
}

function unchecked(file) {
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf8').matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());
}

const runNode = (args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: options.stdio ?? 'inherit', env: process.env });
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });

/** Promote up to `count` pool items into the gap list, then let autopilot seed. */
function refillFromPool(count = 3) {
  if (!existsSync(paths.pool) || !existsSync(paths.gaps)) return 0;
  const pool = readFileSync(paths.pool, 'utf8');
  const lines = [...pool.matchAll(/^- \[ \] (.+)$/gm)].slice(0, count).map((match) => match[0]);
  if (!lines.length) return 0;

  let gaps = readFileSync(paths.gaps, 'utf8');
  const marker = '## 二、候选队列';
  const add = `\n${lines.join('\n')}\n`;
  gaps = gaps.includes(marker) ? gaps.replace(marker, `${marker}\n${add}`) : `${gaps}\n${add}`;
  writeFileSync(paths.gaps, gaps, 'utf8');

  let remaining = pool;
  for (const line of lines) remaining = remaining.replace(`${line}\n`, '');
  writeFileSync(paths.pool, remaining, 'utf8');
  log(`refill: ${lines.length} item(s) moved from the pool into docs/11`);
  return lines.length;
}

function stashFailedRound(reason) {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
    if (!dirty) return;
    execFileSync('git', ['stash', 'push', '-u', '-m', `relentless: ${reason} @ ${new Date().toISOString()}`], {
      cwd: root,
      stdio: 'ignore',
    });
    log(`stashed the dirty tree after ${reason}`);
  } catch {
    log(`stash failed after ${reason}`);
  }
}

function blockFirst(reason) {
  const item = pending()[0];
  if (!item) return;
  try {
    execFileSync(process.execPath, ['scripts/next.mjs', '--block', item], { cwd: root, stdio: 'inherit' });
    log(`blocked after ${reason}: ${item}`);
  } catch {
    log(`could not block: ${item}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function status() {
  const state = existsSync(paths.state) ? JSON.parse(readFileSync(paths.state, 'utf8')) : {};
  const pid = existsSync(paths.lock) ? Number(readFileSync(paths.lock, 'utf8').trim()) : 0;
  let alive = false;
  if (pid) {
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
  }
  console.log(
    JSON.stringify(
      {
        running: alive ? pid : null,
        rounds: state.rounds ?? 0,
        lastCode: state.lastCode ?? null,
        lastItem: state.lastItem ?? null,
        startedAt: state.startedAt ?? null,
        queue: pending().length,
        gaps: unchecked(paths.gaps).length,
        pool: unchecked(paths.pool).length,
      },
      null,
      2,
    ),
  );
}

if (has('--status')) {
  status();
  process.exit(0);
}

// one supervisor per tree
mkdirSync(paths.dir, { recursive: true });
if (existsSync(paths.lock)) {
  const holder = Number(readFileSync(paths.lock, 'utf8').trim());
  try {
    process.kill(holder, 0);
    console.error(`relentless already running (pid ${holder})`);
    process.exit(3);
  } catch {
    log(`stale lock from pid ${holder}`);
  }
}
writeFileSync(paths.lock, String(process.pid), 'utf8');
process.on('exit', () => {
  try {
    writeFileSync(paths.lock, '', 'utf8');
  } catch {
    /* ignore */
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`stopped by ${signal}`);
    saveState({ stopped: new Date().toISOString() });
    process.exit(130);
  });
}

saveState({ pid: process.pid, startedAt: new Date(startedAt).toISOString(), rounds: 0 });
log(`start: pid=${process.pid} patch=${patch} maxHours=${maxHours || 'none'}`);

let rounds = 0;
let lastItem = null;

for (;;) {
  if (maxHours && Date.now() - startedAt > maxHours * 3_600_000) {
    log(`reached --max-hours ${maxHours}; stopping`);
    break;
  }

  if (!pending().length) {
    let code = await runNode(['scripts/autopilot.mjs', '--seed']);
    let queue = pending();
    if (!queue.length && refillFromPool(3) > 0) {
      code = await runNode(['scripts/autopilot.mjs', '--seed']);
      queue = pending();
    }
    if (!queue.length) {
      log('queue, gap list and pool are all empty');
      if (stopWhenDry) break;
      saveState({ state: 'dry' });
      // The pool is supposed to make this unreachable; if it happens, wait for
      // a person to add work rather than exit, and try again.
      await sleep(10 * 60_000);
      continue;
    }
    lastItem = queue[0];
  }

  lastItem = pending()[0] ?? lastItem;
  const before = rounds;
  const args = ['scripts/autopilot.mjs', '--once', '--push'];
  if (patch && existsSync(path.join(root, patch))) args.push('--patch', patch);
  const code = await runNode(args);

  const state = existsSync(paths.state) ? JSON.parse(readFileSync(paths.state, 'utf8')) : {};
  const autopilotRounds = Number(
    (existsSync(path.join(paths.dir, 'autopilot.json'))
      ? JSON.parse(readFileSync(path.join(paths.dir, 'autopilot.json'), 'utf8')).rounds
      : 0) ?? 0,
  );
  rounds = autopilotRounds;
  saveState({ rounds, lastCode: code, lastItem });
  log(`round exit ${code} (autopilot rounds=${rounds}, delta=${rounds - before})`);

  if (code === 0) {
    if (rounds === before) {
      // Nothing ran: the queue was empty or seeding happened only.
      lastItem = pending()[0] ?? null;
      if (!lastItem) refillFromPool(3);
    }
    continue;
  }
  if (code === 3) {
    await sleep(60_000);
    continue;
  }
  if (code === 4) {
    log('agent unavailable; waiting 5 minutes');
    await sleep(5 * 60_000);
    continue;
  }
  if (code === 5) {
    blockFirst('no progress');
    continue;
  }
  if (code === 1 || code === 124) {
    stashFailedRound(`exit ${code}`);
    continue;
  }
  log(`unexpected exit ${code}; waiting 2 minutes`);
  await sleep(2 * 60_000);
}

log('relentless finished');
