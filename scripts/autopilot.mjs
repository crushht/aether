#!/usr/bin/env node
/**
 * Autopilot — the loop that keeps improving this workspace.
 *
 * One round is:
 *   1. read the first unchecked item from NEXT.md (or seed the queue from the
 *      gap list in docs/11-产品差距清单.md when it is empty),
 *   2. hand that item to a fresh headless agent session with the repo rules and
 *      the last gate results,
 *   3. run the gates (typecheck → regression → build),
 *   4. commit the round locally, and push only when asked.
 *
 * It is resumable: state, history and the session id live in .improve/, so a
 * crash, a reboot or a failed gate never loses where the loop was.
 *
 *   node scripts/autopilot.mjs --status
 *   node scripts/autopilot.mjs --once
 *   node scripts/autopilot.mjs --rounds 3 --gates typecheck,regression
 *   node scripts/autopilot.mjs --until-dry --push
 *   node scripts/autopilot.mjs --check            # gates only
 *   node scripts/autopilot.mjs --seed             # promote gaps into NEXT.md
 *   node scripts/autopilot.mjs --dry-run --once
 *   node scripts/autopilot.mjs --once --agent-cmd "claude -p \\"$(cat {{promptFile}})\\""
 *   node scripts/autopilot.mjs --once --resume     # continue the stored session
 *
 * Safety rails: a probe before round one (a silent agent is a hard stop, not a
 * green round), a no-change check after every round, gates before any commit,
 * and a lock so two loops never edit one tree.
 */
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = {
  next: path.join(root, 'NEXT.md'),
  gaps: path.join(root, 'docs', '11-产品差距清单.md'),
  dir: path.join(root, '.improve'),
  state: path.join(root, '.improve', 'autopilot.json'),
  log: path.join(root, '.improve', 'autopilot.log'),
  lock: path.join(root, '.improve', 'autopilot.lock'),
  regression: path.join(root, 'scripts', 'regression.mjs'),
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

const DEFAULTS = {
  rounds: 1,
  gates: 'typecheck,regression',
  timeoutMinutes: 45,
  commit: true,
  push: false,
  seedCount: 3,
};

/* ------------------------------------------------------------------- state */

function readState() {
  try {
    return JSON.parse(readFileSync(paths.state, 'utf8'));
  } catch {
    return { rounds: 0, history: [], notes: [] };
  }
}

function saveState(patch) {
  mkdirSync(paths.dir, { recursive: true });
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  next.history = (next.history ?? []).slice(-80);
  writeFileSync(paths.state, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function log(line) {
  mkdirSync(paths.dir, { recursive: true });
  appendFileSync(paths.log, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
}

/* ------------------------------------------------------------------- queue */

/** Unchecked items inside `## 待办` only; "阻塞" needs outside assets. */
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

function candidates() {
  if (!existsSync(paths.gaps)) return [];
  return [...readFileSync(paths.gaps, 'utf8').matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());
}

/** Move gap-list candidates into NEXT.md so the queue is never empty. */
function seed(limit = DEFAULTS.seedCount) {
  const list = candidates().slice(0, limit);
  if (!list.length) return [];
  let next = readFileSync(paths.next, 'utf8');
  const block = list.map((item) => `- [ ] ${item}`).join('\n');
  next = next.replace(/^(## 待办\s*\n)/m, `$1\n${block}\n`);
  writeFileSync(paths.next, next, 'utf8');

  let gaps = readFileSync(paths.gaps, 'utf8');
  for (const item of list) {
    gaps = gaps.replace(new RegExp(`^- \\[ \\] ${escapeRegExp(item)}\\s*$\\n?`, 'm'), '');
  }
  writeFileSync(paths.gaps, gaps, 'utf8');
  log(`seed: ${list.length} item(s) promoted into NEXT.md`);
  return list;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------- gates */

/** Spawn without a shell: args are passed through untouched. */
function run(command, args, { timeoutMs = 0, inherit = false, extraEnv, onLine } = {}) {
  return spawnAndCollect(command, args, { timeoutMs, inherit, shell: false, extraEnv, onLine });
}

/**
 * npm, npx and git are `.cmd` shims on Windows, which Node refuses to spawn
 * without a shell. One command line string keeps that honest (no args array to
 * mis-quote) and avoids the shell-args deprecation.
 */
function runShell(commandLine, { timeoutMs = 0, inherit = false, extraEnv, onLine } = {}) {
  return spawnAndCollect(commandLine, [], { timeoutMs, inherit, shell: true, extraEnv, onLine });
}

/**
 * Collect a child's output, and — when `onLine` is given — hand every complete
 * line over as it arrives. A long agent round otherwise looks dead: the JSON
 * event stream only becomes visible when the child exits.
 */
function spawnAndCollect(command, args, { timeoutMs, inherit, shell, extraEnv, onLine }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: inherit ? 'inherit' : 'pipe',
      env: { ...process.env, ...(extraEnv ?? {}) },
      shell,
    });
    let output = '';
    let pending = '';
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
        resolve({ code: 124, output: `${output}\n[timeout after ${Math.round(timeoutMs / 60000)} min]` });
      }, timeoutMs);
    }
    const feed = (chunk, fromStderr = false) => {
      const text = chunk.toString();
      output += text;
      if (!onLine || fromStderr) return;
      pending += text;
      let index = pending.indexOf('\n');
      while (index >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
        if (line.trim()) {
          try {
            onLine(line);
          } catch {
            /* a broken progress line must never kill the run */
          }
        }
        index = pending.indexOf('\n');
      }
    };
    child.stdout?.on('data', (chunk) => feed(chunk));
    child.stderr?.on('data', (chunk) => feed(chunk, true));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, output: String(error) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

const GATES = {
  typecheck: {
    label: 'typecheck',
    run: () => run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { timeoutMs: 8 * 60_000 }),
  },
  regression: {
    label: 'regression',
    run: () => run(process.execPath, ['scripts/regression.mjs'], { timeoutMs: 8 * 60_000 }),
  },
  build: { label: 'build', run: () => runShell('npm run build', { timeoutMs: 25 * 60_000 }) },
  i18n: { label: 'i18n', run: () => runShell('npm run i18n', { timeoutMs: 5 * 60_000 }) },
};

async function gates(names) {
  const results = [];
  for (const name of names) {
    const gate = GATES[name];
    if (!gate) {
      results.push({ name, ok: false, code: 2, tail: `unknown gate: ${name}` });
      continue;
    }
    process.stdout.write(`· gate ${gate.label} … `);
    const result = await gate.run();
    const tail = result.output.trim().split('\n').slice(-12).join('\n');
    process.stdout.write(result.code === 0 ? 'ok\n' : `FAILED (${result.code})\n`);
    log(`gate ${gate.label}: exit ${result.code}`);
    results.push({ name: gate.label, ok: result.code === 0, code: result.code, tail });
    if (result.code !== 0) break;
  }
  return results;
}

/* --------------------------------------------------------------------- git */

const git = (line) => runShell(`git ${line}`, { timeoutMs: 120_000 });

async function gitDirty() {
  const result = await git('status --porcelain');
  return result.output.trim().length > 0;
}

async function commit(message) {
  await git('add -A');
  const staged = await git('diff --cached --name-only');
  if (!staged.output.trim()) return { ok: false, reason: 'nothing to commit' };
  const result = await git(`commit -m ${JSON.stringify(message)} --no-verify`);
  return result.code === 0 ? { ok: true } : { ok: false, reason: result.output.trim().split('\n').slice(-4).join(' ') };
}

async function push() {
  const branch = (await git('rev-parse --abbrev-ref HEAD')).output.trim() || 'main';
  const result = await git(`push origin ${branch}`);
  return result.code === 0
    ? { ok: true, branch }
    : { ok: false, reason: result.output.trim().split('\n').slice(-4).join(' ') };
}

/* ------------------------------------------------------------------ prompt */

const promptFile = path.join(paths.dir, 'round-prompt.txt');

/**
 * Start one headless agent round.
 *
 * The prompt goes through a file instead of argv: it is several paragraphs of
 * Chinese with quotes and newlines, and `dsh` on Windows is a `.cmd` shim that
 * would mangle it through a shell. PowerShell reads the file and passes it as
 * one argument, so nothing is re-quoted along the way.
 *
 * `--json` is always on: the opening event carries the session identity (a
 * fresh id per run, unless `--resume` adopts the stored one), and the stream is
 * kept in `.improve/last-round.jsonl` so a quiet round can be explained later.
 *
 * `--agent-cmd` swaps the agent entirely: `{{promptFile}}` and `{{session}}`
 * are substituted, so any one-shot CLI (Codex, Claude Code, a local script)
 * can drive the loop.
 */
async function runAgent(sessionId, prompt, timeoutMs, custom, resume) {
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(promptFile, prompt, 'utf8');

  if (custom) {
    const line = custom.replaceAll('{{promptFile}}', promptFile).replaceAll('{{session}}', sessionId ?? '');
    return { ...(await runShell(line, { timeoutMs, inherit: true })), sessionId: null, final: '', tools: [] };
  }

  const isWindows = process.platform === 'win32';
  const adopt = resume && sessionId ? ` --session-id "${sessionId}"` : '';
  const started = Date.now();
  const onLine = (line) => {
    if (!line.startsWith('{')) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const at = Math.round((Date.now() - started) / 1000);
    if (event.type === 'session') {
      console.log(`  [${at}s] session ${String(event.sessionId ?? '').slice(0, 24)}…`);
    } else if (event.type === 'tool_call') {
      const name = event.name ?? event.tool ?? event.call?.name;
      if (name) console.log(`  [${at}s] · ${name}`);
    } else if (event.type === 'status' && event.status === 'error') {
      console.log(`  [${at}s] ! ${String(event.message ?? 'error').slice(0, 160)}`);
    }
  };
  const result = isWindows
    ? await run(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `& dsh headless --json${adopt} (Get-Content -Raw -LiteralPath "${promptFile}")`,
        ],
        { timeoutMs, onLine },
      )
    : await run(
        'dsh',
        ['headless', '--json', ...(resume && sessionId ? ['--session-id', sessionId] : []), prompt],
        { timeoutMs, onLine },
      );

  return summarizeStream(result);
}

/** Read the NDJSON run back: session id, tool calls, final answer. */
function summarizeStream(result) {
  writeFileSync(path.join(paths.dir, 'last-round.jsonl'), result.output ?? '', 'utf8');
  let sessionId = null;
  let final = '';
  let text = '';
  const tools = [];
  for (const line of (result.output ?? '').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'session' && typeof event.sessionId === 'string') sessionId = event.sessionId;
    if (event.type === 'tool_call') {
      const name = event.name ?? event.tool ?? event.call?.name;
      if (typeof name === 'string') tools.push(name);
    }
    if (event.type === 'text' && typeof event.text === 'string') text += event.text;
    if (event.type === 'final' && typeof event.text === 'string') final = event.text;
  }

  const answer = (final || text).trim();
  console.log(answer ? `agent: ${answer.slice(0, 1_500)}` : 'agent: (no final answer)');
  if (tools.length) console.log(`tools: ${[...new Set(tools)].join(', ')}`);
  log(`agent session ${sessionId ?? 'unknown'}; tools ${tools.length}; answer ${answer.length} chars`);
  return { code: result.code, sessionId, final: answer, tools };
}

/**
 * A one-shot CLI that answers nothing is worse than one that fails: the loop
 * would "succeed" every round without touching a line. Ask the agent for a
 * short answer once, and stop before round one when it stays silent.
 */
async function probeAgent(custom) {
  const probeSession = `aether-probe-${Date.now().toString(36)}`;
  const prompt = 'Reply with the single word OK and nothing else. Do not use tools.';
  if (custom) {
    const line = custom
      .replaceAll('{{promptFile}}', path.join(paths.dir, 'probe-prompt.txt'))
      .replaceAll('{{session}}', probeSession);
    writeFileSync(path.join(paths.dir, 'probe-prompt.txt'), prompt, 'utf8');
    const result = await runShell(line, { timeoutMs: 120_000 });
    return { ok: result.code === 0 && result.output.trim().length > 0, output: result.output.slice(-400), code: result.code };
  }

  const isWindows = process.platform === 'win32';
  const result = isWindows
    ? await run(
        'powershell',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `& dsh headless --session-id "${probeSession}" "${prompt}"`,
        ],
        { timeoutMs: 120_000 },
      )
    : await run('dsh', ['headless', '--session-id', probeSession, prompt], { timeoutMs: 120_000 });
  return { ok: result.code === 0 && result.output.trim().length > 0, output: result.output.slice(-400), code: result.code };
}

function promptFor(item, state, gateSummary) {
  const round = (state.rounds ?? 0) + 1;
  return `继续完善 Aether（当前工作目录）。这是自主循环的第 ${round} 轮。

本轮目标：
${item}

开始前读：README.md、NEXT.md 的「规则」、docs/11-产品差距清单.md、docs/10-ChatGPT-Linear优化总表.md。
最近的门禁结果：
${gateSummary || '（还没有记录）'}

执行要求：
1. 先看源码确认现状，不要重复已实现的能力；一次只推进这一条，做小、做完整。
2. 纯逻辑放进可测试的模块，并补 scripts/regression.mjs 的用例；界面改动要在真实 dev 服务器上验收（AUTH_DISABLED=1 或真实账号）。
3. 保持 BYOM（bring your own model）、本地数据、既有能力不退化；不删用户数据，不改 .data/。
4. 每轮结束前必须让 npx tsc --noEmit 与 node scripts/regression.mjs 通过；能跑 build 就跑。
5. 不要执行 git commit / push —— 驱动器会在门禁通过后提交。
6. 完成后用 node scripts/next.mjs --done "<该条原文>" 勾选，并在 NEXT.md「已完成」追加一行（含验证方式）。
7. 如果这条确实需要外部资产（证书、发布源）才能完成，把它改写成一条可验证的子任务继续做，不要空转。

可用的能力：web_search / fetch_url（联网查资料）、inspect_artifact（静态逆向：格式、熵、PE/ELF/ZIP、字符串、指示器）、connector 代理、工作流与知识库。用它们验证结论，而不是凭记忆。`;
}

/* -------------------------------------------------------------------- main */

async function status() {
  const state = readState();
  const items = pending();
  const gaps = candidates();
  const dirty = await gitDirty();
  let name = path.basename(root);
  try {
    name = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).name ?? name;
  } catch {
    /* keep the folder name */
  }

  // Is a loop alive right now? The lock holds its pid; mtime is when it started.
  let running = null;
  try {
    const pid = Number(readFileSync(paths.lock, 'utf8').trim());
    if (pid) {
      process.kill(pid, 0);
      const since = statSync(paths.lock).mtime;
      running = {
        pid,
        since: since.toISOString(),
        minutes: Math.round((Date.now() - since.getTime()) / 60_000),
        item: state.lastItem ?? null,
        phase: state.phase ?? null,
      };
    }
  } catch {
    /* no loop running */
  }

  console.log(
    JSON.stringify(
      {
        project: name,
        running,
        pending: items.length,
        next: items[0] ?? (gaps.length ? `(queue empty — ${gaps.length} candidate(s) can be seeded)` : null),
        candidates: gaps.length,
        rounds: state.rounds ?? 0,
        sessionId: state.sessionId ?? null,
        lastGate: state.lastGate ?? null,
        gitDirty: dirty,
        recent: (state.history ?? []).slice(-5),
      },
      null,
      2,
    ),
  );
}

function lock() {
  mkdirSync(paths.dir, { recursive: true });
  if (existsSync(paths.lock)) {
    const holder = Number(readFileSync(paths.lock, 'utf8').trim());
    if (holder && holder !== process.pid) {
      try {
        process.kill(holder, 0);
        console.error(`autopilot already running (pid ${holder}); remove ${path.relative(root, paths.lock)} if that is stale.`);
        process.exit(3);
      } catch {
        /* stale lock */
      }
    }
  }
  writeFileSync(paths.lock, String(process.pid), 'utf8');
  const release = () => rmSync(paths.lock, { force: true });
  process.on('exit', release);
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
}

if (has('--status')) {
  await status();
} else if (has('--seed')) {
  const seeded = seed(num('--seed-count', DEFAULTS.seedCount));
  console.log(seeded.length ? `seeded:\n- ${seeded.join('\n- ')}` : 'no candidates to seed');
} else if (has('--check')) {
  const names = value('--gates', DEFAULTS.gates).split(',').map((name) => name.trim()).filter(Boolean);
  const results = await gates(names);
  saveState({ lastGate: { at: new Date().toISOString(), results } });
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
} else {
  const rounds = has('--until-dry') ? Infinity : num('--rounds', DEFAULTS.rounds);
  const gateNames = value('--gates', DEFAULTS.gates).split(',').map((name) => name.trim()).filter(Boolean);
  const doCommit = !has('--no-commit') && DEFAULTS.commit;
  const doPush = has('--push') || DEFAULTS.push;
  const dryRun = has('--dry-run');
  const noAgent = has('--no-agent');
  const customAgent = value('--agent-cmd', '');
  const timeoutMs = num('--timeout', DEFAULTS.timeoutMinutes) * 60_000;

  if (!dryRun) lock();
  let state = readState();
  if (!state.sessionId) state = saveState({ sessionId: `aether-autopilot-${Date.now().toString(36)}`, rounds: 0, history: [] });

  if (!dryRun && !noAgent && !has('--no-probe')) {
    process.stdout.write('· probing the agent … ');
    const probe = await probeAgent(customAgent);
    process.stdout.write(probe.ok ? 'answered\n' : 'SILENT\n');
    log(`agent probe: ${probe.ok ? 'ok' : `silent (exit ${probe.code})`}`);
    if (!probe.ok && !has('--force')) {
      console.error(
        [
          'The one-shot agent produced no answer, so a round would change nothing.',
          'For the dsh headless profile this usually means its credentials are missing:',
          '  the headless profile reads API keys from the launch environment, <cwd>/.env or $DSH_HOME/.env,',
          '  and ignores keys saved in the GUI.',
          'Point the loop at another CLI instead with:',
          '  node scripts/autopilot.mjs --once --agent-cmd "claude -p \\"$(cat {{promptFile}})\\""',
          'or pass --force to run anyway, or --no-agent to only run the gates.',
        ].join('\n'),
      );
      saveState({ phase: 'agent-unavailable' });
      process.exitCode = 4;
      process.exit();
    }
  }

  let completed = 0;
  for (let round = 1; round <= rounds; round += 1) {
    let items = pending();
    if (!items.length) {
      const seeded = seed(DEFAULTS.seedCount);
      if (seeded.length) items = pending();
    }
    if (!items.length) {
      console.log('queue is empty and there is nothing to seed — stopping.');
      saveState({ phase: 'queue-complete' });
      break;
    }

    const item = items[0];
    const gateSummary = (readState().lastGate?.results ?? [])
      .map((result) => `${result.name}: ${result.ok ? 'pass' : `fail (${result.code})`}`)
      .join(', ');
    const text = promptFor(item, readState(), gateSummary);

    console.log(`\n=== autopilot round ${(readState().rounds ?? 0) + 1} · ${item}\n`);
    if (dryRun) {
      console.log(
        customAgent
          ? `agent: ${customAgent}`
          : `dsh headless --session-id ${state.sessionId} "<prompt>"`,
      );
      console.log('--- prompt ---');
      console.log(text);
      break;
    }

    saveState({ phase: 'working', lastItem: item });
    log(`round start: ${item}`);
    const before = (await git('status --porcelain')).output;

    if (!noAgent) {
      const result = await runAgent(state.sessionId, text, timeoutMs, customAgent, has('--resume'));
      if (result.sessionId) saveState({ sessionId: result.sessionId });
      log(`agent exit ${result.code}`);
      if (result.code !== 0) {
        saveState({ phase: 'agent-failed', lastExitCode: result.code });
        console.error(`agent exited ${result.code}; state saved, re-run to continue.`);
        process.exitCode = result.code;
        break;
      }
    }

    const after = (await git('status --porcelain')).output;
    if (!noAgent && after === before && !has('--allow-empty-rounds')) {
      console.error(
        `the agent finished but the tree did not change — "${item}" needs a person, a different agent or clearer instructions.`,
      );
      log(`no progress: ${item}`);
      saveState({ phase: 'no-progress', lastItem: item });
      process.exitCode = 5;
      break;
    }

    const results = await gates(gateNames);
    const allOk = results.every((result) => result.ok);
    saveState({ lastGate: { at: new Date().toISOString(), results }, phase: allOk ? 'gate-passed' : 'gate-failed' });
    if (!allOk) {
      const failed = results.find((result) => !result.ok);
      console.error(`gate ${failed?.name} failed:\n${failed?.tail ?? ''}`);
      log(`gate failed: ${failed?.name}`);
      if (has('--revert-on-fail')) {
        await git(`stash push -u -m "autopilot: failed round (${failed?.name ?? 'gate'})"`);
        console.log('changes stashed so the tree stays green.');
      }
      process.exitCode = 1;
      break;
    }

    if (doCommit) {
      const committed = await commit(`feat: ${item.slice(0, 64)}`);
      if (committed.ok) {
        console.log('committed.');
        log(`commit: ${item}`);
      } else {
        console.log(`nothing committed (${committed.reason}).`);
      }
    }

    // Push per round, not once at the end: a long --until-dry run should not
    // lose ten finished rounds to one flaky minute on the network.
    if (doPush) {
      const pushed = await push();
      console.log(pushed.ok ? `pushed to origin/${pushed.branch}.` : `push failed: ${pushed.reason}`);
      log(`push: ${pushed.ok ? 'ok' : pushed.reason}`);
    }

    completed += 1;
    saveState({
      rounds: (readState().rounds ?? 0) + 1,
      phase: 'round-complete',
      history: [
        ...(readState().history ?? []),
        { at: new Date().toISOString(), item, gates: results.map((result) => `${result.name}:${result.ok ? 'ok' : 'fail'}`) },
      ],
    });
    console.log(`round done (${completed} this run).`);
  }

  if (doPush && !dryRun && !process.exitCode) {
    const pushed = await push();
    if (!pushed.ok) {
      console.log(`final push failed: ${pushed.reason}`);
      process.exitCode = 1;
    }
  }
  if (!dryRun) saveState({ phase: 'idle' });
  console.log(`\nautopilot finished: ${completed} round(s) completed.`);
}
