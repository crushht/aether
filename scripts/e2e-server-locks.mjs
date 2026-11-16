// Regression: every updateAether route must settle quickly (no nested lock).
import assert from 'node:assert/strict';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const timeout = 6000;

async function timed(name, request) {
  const started = Date.now();
  const response = await request();
  const ms = Date.now() - started;
  assert.ok(response, `${name}: no response`);
  assert.ok(ms < timeout, `${name}: took ${ms}ms (updateAether deadlock?)`);
  return { response, ms };
}

const call = (url, init) =>
  fetch(`${base}${url}`, { ...init, signal: AbortSignal.timeout(timeout) });

// Knowledge: create, patch, delete.
const knowledge = await timed('knowledge POST', () =>
  call('/api/agent/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'note', title: 'Lock regression note', content: 'deadlock check' }),
  }),
);
assert.ok(knowledge.response.ok, 'knowledge create must succeed');
const knowledgeId = (await knowledge.response.json()).item.id;
await timed('knowledge PATCH', () =>
  call('/api/agent/knowledge', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: knowledgeId, title: 'Lock regression note v2' }),
  }),
);
await timed('knowledge DELETE', () => call(`/api/agent/knowledge?id=${encodeURIComponent(knowledgeId)}`, { method: 'DELETE' }));

// Memory: add and clear.
await timed('memory POST', () =>
  call('/api/agent/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'lock regression memory', kind: 'note' }),
  }),
);
await timed('memory DELETE', () =>
  call('/api/agent/memory', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'all', all: true }),
  }),
);

// Workflows: create, append a run, delete.
const created = await timed('workflow POST', () =>
  call('/api/agent/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lock regression workflow', prompt: 'noop' }),
  }),
);
assert.ok(created.response.ok, 'workflow create must succeed');
const workflowId = (await created.response.json()).workflow.id;
await timed('workflow PATCH', () =>
  call('/api/agent/workflows', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: workflowId, appendRun: { status: 'canceled', summary: 'canceled in test' } }),
  }),
);
await timed('workflow DELETE', () => call(`/api/agent/workflows?id=${encodeURIComponent(workflowId)}`, { method: 'DELETE' }));

console.log('PASS API: knowledge, memory and workflow writes settle without an aether lock deadlock');
