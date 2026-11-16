// Acceptance for the task center: running agent runs, failed workflows and stop.
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, newPage, viewport, goto, evaluate } from '../study/cdp.mjs';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const chrome = await launch({ port: 9450, profile: path.join(process.env.TEMP || '.', `aether-tasks-${process.pid}`) });
let page;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(page, expr)) return true;
    await wait(250);
  }
  return false;
};

try {
  page = await newPage(9450);
  await viewport(page, 1440, 960);
  await goto(page, `${base}/team/ENG`, 5000);
  assert.ok(await waitFor(`!!window.__AETHER_AGENT__ && !!window.__AETHER_DEBUG__ && !!window.__AETHER_WORKSPACE__`), 'stores must boot');

  // Fixture: one running chat run plus one failed workflow.
  const fixture = await evaluate(page, `(() => {
    const chats = window.__AETHER_DEBUG__.useChats;
    const agent = window.__AETHER_AGENT__;
    const workspace = window.__AETHER_WORKSPACE__;
    const chat = chats.getState().newChat();
    chats.getState().rename(chat.id, 'Long running task');
    const key = 'chat:' + chat.id;
    agent.setState((state) => ({ hydrated: true, sessions: { ...state.sessions, [key]: {
      targetId: key, status: 'running', messages: [{ role: 'user', content: 'Analyse the workspace' }],
      log: [{ id: 'l1', kind: 'user', text: 'Analyse the workspace', at: Date.now() }],
      prompt: 'Analyse the workspace', at: Date.now(), model: 'demo-model',
    } } }));
    workspace.setState((state) => ({ workflows: [...state.workflows, {
      id: 'wf-task-fixture', name: 'Nightly triage', description: '', prompt: 'triage', providerId: null, model: '',
      trigger: { kind: 'manual' }, enabled: true, allowWrites: false, createIssue: false, issueStatus: 'todo', projectId: null,
      maxSteps: 6, lastRunAt: Date.now(), runs: [{ id: 'run-1', at: Date.now(), status: 'error', summary: '', steps: 1, tools: 0, error: 'provider timeout' }],
      createdAt: Date.now(), updatedAt: Date.now(),
    }] }));
    return { chatId: chat.id, key };
  })()`);
  await wait(700);

  assert.ok(await evaluate(page, `!!document.querySelector('[data-task-center]')`), 'task center must appear when work exists');
  const badge = await evaluate(page, `document.querySelector('[data-task-center]').innerText.trim()`);
  assert.ok(badge.includes('1'), `running count badge expected, got ${badge}`);

  await evaluate(page, `document.querySelector('[data-task-center]').click()`);
  await wait(300);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-task-panel]')`), 'task panel must open');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-task-row="agent"]')`), 'running agent row must show');
  assert.ok(await evaluate(page, `!!document.querySelector('[data-task-row="workflow-failed"]')`), 'failed workflow row must show');
  assert.ok((await evaluate(page, `document.querySelector('[data-task-panel]').innerText`)).includes('provider timeout'), 'failure reason must be visible');

  // Opening the task selects its conversation.
  await evaluate(page, `document.querySelector('[data-task-row="agent"] button').click()`);
  await wait(500);
  assert.ok(await evaluate(page, `!!document.querySelector('[data-agent-chat]')`), 'clicking a task must open its conversation');
  assert.equal(await evaluate(page, `window.__AETHER_DEBUG__.useChats.getState().activeId`), fixture.chatId);

  // Reopen and stop it; the running row disappears.
  await evaluate(page, `document.querySelector('[data-task-center]')?.click()`);
  await wait(300);
  await evaluate(page, `document.querySelector('[data-task-row="agent"] [aria-label="停止"], [data-task-row="agent"] [aria-label="Stop"]')?.click()`);
  await wait(500);
  assert.equal(await evaluate(page, `window.__AETHER_AGENT__.getState().sessions['${fixture.key}']?.status`), 'idle');
  assert.equal(await evaluate(page, `!!document.querySelector('[data-task-row="agent"]')`), false, 'stopped run must leave the active list');

  console.log('PASS browser: task center lists runs, shows failures, opens and stops them');
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}
