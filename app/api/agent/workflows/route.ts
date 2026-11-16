import { NextResponse } from 'next/server';
import { readAether, updateAether } from '@/lib/server/aether';
import { requireUser } from '@/lib/server-auth';
import type { AgentWorkflow, WorkflowRun, WorkflowTrigger } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const newId = () => `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const cleanTrigger = (value: unknown): WorkflowTrigger => {
  const trigger = (value ?? {}) as Partial<WorkflowTrigger>;
  if (trigger.kind === 'daily') {
    return { kind: 'daily', hour: Math.min(23, Math.max(0, Math.round(Number(trigger.hour ?? 9)))) };
  }
  if (trigger.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekday: Math.min(7, Math.max(1, Math.round(Number(trigger.weekday ?? 1)))),
      hour: Math.min(23, Math.max(0, Math.round(Number(trigger.hour ?? 9)))),
    };
  }
  if (trigger.kind === 'interval') {
    return { kind: 'interval', minutes: Math.min(1440, Math.max(5, Math.round(Number(trigger.minutes ?? 60)))) };
  }
  return { kind: 'manual' };
};

const cleanRun = (value: Partial<WorkflowRun>): WorkflowRun => ({
  id: String(value.id ?? `run_${Date.now().toString(36)}`),
  at: Number(value.at) || Date.now(),
  status:
    value.status === 'ok' || value.status === 'error' || value.status === 'canceled'
      ? value.status
      : value.status === 'running'
        ? 'running'
        : 'ok',
  summary: String(value.summary ?? '').slice(0, 4_000),
  steps: Math.max(0, Math.round(Number(value.steps ?? 0))),
  tools: Math.max(0, Math.round(Number(value.tools ?? 0))),
  ms: value.ms !== undefined ? Math.max(0, Math.round(Number(value.ms))) : undefined,
  model: value.model ? String(value.model).slice(0, 120) : undefined,
  issueKey: value.issueKey ? String(value.issueKey).slice(0, 40) : undefined,
  error: value.error ? String(value.error).slice(0, 1_000) : undefined,
  events: Array.isArray(value.events)
    ? value.events.slice(-100).map((event) => ({
        kind: ['step', 'tool', 'final', 'error'].includes(String(event.kind)) ? event.kind : 'step',
        text: String(event.text ?? '').slice(0, 600),
        at: Number(event.at) || Date.now(),
        ...(typeof event.ok === 'boolean' ? { ok: event.ok } : {}),
      }))
    : [],
});

export async function GET(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });
  const store = await readAether(account.id);
  return NextResponse.json({ ok: true, workflows: store.workflows });
}

export async function POST(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: Partial<AgentWorkflow>;
  try {
    body = (await request.json()) as Partial<AgentWorkflow>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) return NextResponse.json({ ok: false, error: 'A prompt is required.' }, { status: 400 });

  const workflow: AgentWorkflow = {
    id: newId(),
    name: String(body.name ?? '').trim().slice(0, 120) || 'Untitled workflow',
    description: String(body.description ?? '').slice(0, 600),
    prompt: prompt.slice(0, 8_000),
    providerId: body.providerId ? String(body.providerId) : null,
    model: String(body.model ?? '').slice(0, 120),
    trigger: cleanTrigger(body.trigger),
    enabled: body.enabled !== false,
    allowWrites: Boolean(body.allowWrites),
    createIssue: Boolean(body.createIssue),
    issueStatus: ['backlog', 'todo', 'in_progress'].includes(String(body.issueStatus))
      ? (body.issueStatus as 'backlog' | 'todo' | 'in_progress')
      : 'todo',
    projectId: body.projectId ? String(body.projectId) : null,
    maxSteps: Math.min(20, Math.max(1, Math.round(Number(body.maxSteps ?? 6)))),
    lastRunAt: null,
    runs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const next = await updateAether(account.id, (store) => ({ workflows: [workflow, ...store.workflows] }));
  return NextResponse.json({ ok: true, workflow, workflows: next.workflows });
}

export async function PATCH(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  let body: { id?: string; patch?: Partial<AgentWorkflow>; appendRun?: Partial<WorkflowRun> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const patch = body.patch ?? {};
  const run = body.appendRun ? cleanRun(body.appendRun) : null;
  const next = await updateAether(account.id, (store) => {
    const existing = store.workflows.find((item) => item.id === body.id);
    if (!existing) return {};
    const updated: AgentWorkflow = {
      ...existing,
      ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 120) } : {}),
      ...(patch.description !== undefined ? { description: String(patch.description).slice(0, 600) } : {}),
      ...(patch.prompt !== undefined ? { prompt: String(patch.prompt).slice(0, 8_000) } : {}),
      ...(patch.providerId !== undefined ? { providerId: patch.providerId ? String(patch.providerId) : null } : {}),
      ...(patch.model !== undefined ? { model: String(patch.model).slice(0, 120) } : {}),
      ...(patch.trigger !== undefined ? { trigger: cleanTrigger(patch.trigger) } : {}),
      ...(patch.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
      ...(patch.allowWrites !== undefined ? { allowWrites: Boolean(patch.allowWrites) } : {}),
      ...(patch.createIssue !== undefined ? { createIssue: Boolean(patch.createIssue) } : {}),
      ...(patch.issueStatus !== undefined && ['backlog', 'todo', 'in_progress'].includes(String(patch.issueStatus))
        ? { issueStatus: patch.issueStatus as 'backlog' | 'todo' | 'in_progress' }
        : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId ? String(patch.projectId) : null } : {}),
      ...(patch.maxSteps !== undefined
        ? { maxSteps: Math.min(20, Math.max(1, Math.round(Number(patch.maxSteps)))) }
        : {}),
      runs: run ? [run, ...existing.runs].slice(0, 20) : existing.runs,
      lastRunAt: run ? run.at : existing.lastRunAt,
      updatedAt: Date.now(),
    };
    return { workflows: store.workflows.map((item) => (item.id === updated.id ? updated : item)) };
  });
  const updated = next.workflows.find((item) => item.id === body.id);
  if (!updated) return NextResponse.json({ ok: false, error: 'Workflow not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, workflow: updated, workflows: next.workflows });
}

export async function DELETE(request: Request) {
  const account = await requireUser(request);
  if (!account) return NextResponse.json({ ok: false, error: 'Sign in to continue.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  const next = await updateAether(account.id, (store) => ({
    workflows: store.workflows.filter((item) => item.id !== id),
  }));
  return NextResponse.json({ ok: true, workflows: next.workflows });
}
