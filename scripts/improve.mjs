#!/usr/bin/env node
/** A resumable project-improvement driver. No dependencies, safe to re-run. */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nextFile = path.join(root, 'NEXT.md');
const stateDir = path.join(root, '.improve');
const stateFile = path.join(stateDir, 'state.json');
const logFile = path.join(stateDir, 'history.log');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const readState = () => {
  try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return {}; }
};
const saveState = (patch) => {
  mkdirSync(stateDir, { recursive: true });
  const state = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, stateFile);
  return state;
};
const queue = () => {
  const text = readFileSync(nextFile, 'utf8').split('## 已完成')[0];
  return [...text.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());
};
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, commandArgs) => new Promise((resolve) => {
  const child = spawn(cmd, commandArgs, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('error', () => resolve(1));
  child.on('close', (code) => resolve(code ?? 1));
});
const check = async () => {
  for (const commandArgs of [['run', 'typecheck'], ['run', 'build']]) {
    const code = await run(command, commandArgs);
    if (code) return code;
  }
  if (existsSync(path.join(root, 'scripts', 'regression.mjs'))) {
    const code = await run(process.execPath, ['scripts/regression.mjs']);
    if (code) return code;
  }
  return 0;
};
const prompt = (item, state) => `继续完善当前工作区的 Aether 项目。先读 README.md、NEXT.md、docs/10-ChatGPT-Linear优化总表.md 和 .improve/state.json。
当前阶段：${item}
这是同一持久 agent 会话的第 ${(state.rounds ?? 0) + 1} 次续跑。先检查源码与上次验证结果，不要重复已实现内容。实现当前阶段中一组连贯、可验证的改进；保持 BYOM、本地数据与既有能力，保留用户数据，不做 git commit/push。新增纯逻辑写回归测试，涉及界面的用真实页面验证。
完成后把本阶段已完成的具体内容、验证命令与遗留问题追加到 .improve/state.json 的 notes。若当前阶段完整达成，用 node scripts/next.mjs --done "${item.replaceAll('"', '\\"')}" 勾选它。若尚未完整达成，保留待办并继续下一组。只有缺少无法从代码推断的关键决策才在 notes 记录 blocker；不要因任务很大而提前结束。`;

const status = () => {
  const state = readState();
  const items = queue();
  console.log(JSON.stringify({
    project: path.basename(root), remaining: items.length, next: items[0] ?? null,
    sessionId: state.sessionId ?? null, rounds: state.rounds ?? 0,
    lastExitCode: state.lastExitCode ?? null, updatedAt: state.updatedAt ?? null,
    lastStage: state.lastStage ?? null, notes: state.notes?.slice(-5) ?? [],
  }, null, 2));
};

if (has('--status') || (!has('--check') && !has('--agent') && !has('--once'))) {
  status();
} else if (has('--check')) {
  saveState({ phase: 'checking', lastStage: queue()[0] ?? null });
  const code = await check();
  saveState({ phase: code ? 'check-failed' : 'checked', lastExitCode: code });
  process.exitCode = code;
} else {
  mkdirSync(stateDir, { recursive: true });
  let state = readState();
  if (!state.sessionId) state = saveState({ sessionId: `aether-improve-${randomUUID()}`, rounds: 0, notes: [] });
  const limit = Math.max(1, Number(value('--rounds', has('--once') ? '1' : '20')) || 1);
  if (has('--dry-run')) {
    console.log(`dsh headless --session-id ${state.sessionId} "<NEXT.md 当前阶段>"`);
    console.log(`rounds=${limit}; cwd=${root}; next=${queue()[0] ?? 'ALL_DONE'}`);
  } else {
    for (let round = 0; round < limit; round += 1) {
      const items = queue();
      if (!items.length) {
        saveState({ phase: 'queue-complete' });
        const code = await check();
        saveState({ phase: code ? 'check-failed' : 'complete', lastExitCode: code });
        process.exitCode = code;
        break;
      }
      const item = items[0];
      state = saveState({ phase: 'working', lastStage: item, rounds: (state.rounds ?? 0) + 1 });
      appendFileSync(logFile, `[${new Date().toISOString()}] round=${state.rounds} stage=${item}\n`, 'utf8');
      console.log(`\n=== Aether improvement ${state.rounds}/${(state.rounds ?? 1) + limit - round - 1} ===\n${item}\n`);
      const code = await run('dsh', ['headless', '--session-id', state.sessionId, prompt(item, state)]);
      saveState({ phase: code ? 'interrupted' : 'round-complete', lastExitCode: code });
      appendFileSync(logFile, `[${new Date().toISOString()}] exit=${code}\n`, 'utf8');
      if (code) {
        console.error(`本轮退出码 ${code}；状态已保存，可用 npm run improve 继续。`);
        process.exitCode = code;
        break;
      }
    }
  }
}
