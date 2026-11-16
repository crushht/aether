// Workspace backups: writes snapshot aside, lists and restores one.
import assert from 'node:assert/strict';

const base = process.env.AETHER_URL || 'http://127.0.0.1:4321';
const call = async (url, init) => {
  const response = await fetch(`${base}${url}`, init);
  return { response, json: await response.json().catch(() => ({})) };
};

const current = await call('/api/workspace');
assert.ok(current.response.ok, 'workspace must load');
const emptyBackups = await call('/api/workspace/backups');
assert.ok(emptyBackups.response.ok && Array.isArray(emptyBackups.json.backups), 'backup list must answer');

const snapshot = {
  issues: current.json.issues,
  labels: current.json.labels,
  projects: current.json.projects,
  cycles: current.json.cycles,
  notifications: current.json.notifications,
  baseVersion: current.json.updatedAt,
};

const markerId = `bk_${Date.now()}`;
const marked = {
  ...snapshot,
  issues: [
    ...snapshot.issues,
    {
      id: markerId, key: 'ENG-9999', title: 'Backup marker', description: '', status: 'todo', priority: 'none',
      assigneeId: null, labelIds: [], projectId: null, cycleId: null, parentId: null, estimate: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [], activities: [],
      attachments: [], starred: false,
    },
  ],
};

const firstWrite = await call('/api/workspace', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(marked),
});
assert.ok(firstWrite.response.ok, 'first write must succeed');

const secondWrite = await call('/api/workspace', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...marked, baseVersion: firstWrite.json.updatedAt }),
});
assert.ok(secondWrite.response.ok, 'second write must succeed');

const list = await call('/api/workspace/backups');
assert.ok(list.json.backups.length >= 2, `expected at least two backups, got ${list.json.backups.length}`);
assert.ok(list.json.backups.every((backup) => typeof backup.issues === 'number'), 'each backup reports its issue count');
assert.ok(list.json.backups.every((backup) => typeof backup.projects === 'number'), 'each backup reports its project count');
const oldest = list.json.backups[list.json.backups.length - 1];

const restore = await call('/api/workspace/backups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: oldest.id }),
});
assert.ok(restore.response.ok, 'restore must succeed');

const after = await call('/api/workspace');
assert.equal(after.json.issues.some((issue) => issue.id === markerId), false, 'restoring the first backup removes the later marker');

// Manual create and delete.
const manual = await call('/api/workspace/backups', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'create' }),
});
assert.ok(manual.response.ok && manual.json.backups.length >= 3, 'manual backup must add one');
const manualId = manual.json.backups[0].id;
const removed = await call(`/api/workspace/backups?id=${encodeURIComponent(manualId)}`, { method: 'DELETE' });
assert.ok(removed.response.ok, 'deleting a backup must succeed');
const afterDelete = await call('/api/workspace/backups');
assert.equal(afterDelete.json.backups.some((backup) => backup.id === manualId), false, 'deleted backup must be gone');

console.log('PASS API: workspace writes create backups, restore rolls back, manual create/delete work');
