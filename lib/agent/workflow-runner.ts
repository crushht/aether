'use client';

import { create } from 'zustand';
import { useData } from '@/lib/store/data';
import { useUI } from '@/lib/store/ui';
import { getLocale, translate } from '@/lib/i18n';
import { chat, ProviderError } from './provider';
import { READ_ONLY_TOOLS, runTool, toolSchemas, workspaceSummary } from './tools';
import { isModelReady, resolveModelTarget, useWorkspace } from './workspace';
import type { AgentMessage, AgentWorkflow, ModelTarget, WorkflowRun, WorkflowRunEvent } from './types';

/**
 * Workflow execution: one saved instruction, one bounded agent loop, and a
 * reviewable run record. It reuses the same provider layer and tool registry as
 * the interactive agent, so a workflow can never do something a person cannot.
 */

const WORKFLOW_PROMPT = `You are a workflow runner inside Aether, a workspace that combines issue tracking with an AI agent.
You run one saved instruction without a human in the loop. Rules:
- Work only from the workspace data and the knowledge base; never invent issues, people or numbers.
- Read before writing. A write is allowed only when the workflow explicitly permits it; if a tool result says it is read-only, do not retry.
- Finish with a compact report: what you checked, what you found, and anything that needs a person. Plain text, no headings.
- Write statuses and priorities as words in the user's language (in_progress → 进行中 / In Progress); never paste raw keys such as in_progress or high into the report.`;

const MAX_TOOL_ROUNDS = 20;

export interface WorkflowProgress {
  step: number;
  maxSteps: number;
  tool: string | null;
  startedAt: number;
}

interface RuntimeState {
  running: string[];
  progress: Record<string, WorkflowProgress>;
  start: (id: string, maxSteps?: number) => void;
  updateProgress: (id: string, patch: Partial<WorkflowProgress>) => void;
  finish: (id: string) => void;
}

export const useWorkflowRuntime = create<RuntimeState>((set) => ({
  running: [],
  progress: {},
  start: (id, maxSteps = 1) =>
    set((state) => ({
      running: [...new Set([...state.running, id])],
      progress: {
        ...state.progress,
        [id]: { step: 0, maxSteps: Math.max(1, maxSteps), tool: null, startedAt: Date.now() },
      },
    })),
  updateProgress: (id, patch) =>
    set((state) =>
      state.progress[id]
        ? { progress: { ...state.progress, [id]: { ...state.progress[id], ...patch } } }
        : state,
    ),
  finish: (id) =>
    set((state) => {
      const progress = { ...state.progress };
      delete progress[id];
      return { running: state.running.filter((item) => item !== id), progress };
    }),
}));

export function workflowTarget(workflow: AgentWorkflow): ModelTarget | null {
  const workspace = useWorkspace.getState();
  const base = resolveModelTarget(workspace, 'workflow');
  const provider = workflow.providerId
    ? workspace.providers.find((item) => item.id === workflow.providerId) ?? null
    : null;

  if (!provider) {
    if (!base) return null;
    return { ...base, model: workflow.model || base.model };
  }

  return {
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    model: workflow.model || provider.defaultModel || provider.models[0] || '',
    temperature: provider.temperature,
    maxSteps: workflow.maxSteps,
    contextWindow: provider.contextWindow,
    requireApproval: !workflow.allowWrites,
    systemPrompt: workspace.instructions,
    persona: workspace.persona,
    hasKey: provider.hasKey,
    keyHint: provider.keyHint,
  };
}

const titleFrom = (text: string) => {
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) ?? 'Workflow report';
  return first.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').slice(0, 120);
};

const controllers = new Map<string, AbortController>();

/** Stop a workflow wherever it runs: abort this tab and ask the server to stop. */
export function cancelWorkflow(id: string) {
  controllers.get(id)?.abort();
  void fetch('/api/agent/workflows/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: id }),
  }).catch(() => undefined);
}

export async function runWorkflowNow(workflow: AgentWorkflow): Promise<WorkflowRun> {
  const runtime = useWorkflowRuntime.getState();
  if (runtime.running.includes(workflow.id)) {
    return {
      id: `run_${Date.now().toString(36)}`,
      at: Date.now(),
      status: 'error',
      summary: '',
      steps: 0,
      tools: 0,
      error: 'This workflow is already running.',
    };
  }

  runtime.start(workflow.id, Math.min(MAX_TOOL_ROUNDS, Math.max(1, workflow.maxSteps)));
  const controller = new AbortController();
  controllers.set(workflow.id, controller);
  const startedAt = Date.now();
  const workspace = useWorkspace.getState();
  await workspace.hydrate();

  const target = workflowTarget(workflow);
  const record = (run: WorkflowRun) => {
    void useWorkspace.getState().updateWorkflow(workflow.id, {}, run);
    return run;
  };

  if (!target || !isModelReady(target)) {
    useWorkflowRuntime.getState().finish(workflow.id);
    return record({
      id: `run_${startedAt.toString(36)}`,
      at: startedAt,
      status: 'error',
      summary: '',
      steps: 0,
      tools: 0,
      error: target ? 'This provider has no API key.' : 'No model provider is configured.',
    });
  }

  const memory = workspace.memoryEnabled ? workspace.memory.slice(-20) : [];
  const system = [
    workspace.persona ? `${workspace.persona}\n\n` : '',
    WORKFLOW_PROMPT,
    workspace.instructions ? `\nWorkspace instructions:\n${workspace.instructions}` : '',
    memory.length
      ? `\nLong-term memory:\n${memory.map((item) => `- [${item.kind}] ${item.text}`).join('\n')}`
      : '',
    workspace.knowledge.length
      ? `\nKnowledge base (${workspace.knowledge.length} entries):\n${workspace.knowledge
          .slice(0, 20)
          .map((item) => `- ${item.title}`)
          .join('\n')}`
      : '',
    `\nWorkspace context:\n${workspaceSummary()}`,
    `\nWorkflow: ${workflow.name}\n${workflow.description || ''}`.trim(),
  ].join('');

  const messages: AgentMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: workflow.prompt },
  ];

  let steps = 0;
  let tools = 0;
  let finalText = '';
  let failure = '';
  let aborted = false;
  const events: WorkflowRunEvent[] = [];
  const trace = (kind: WorkflowRunEvent['kind'], text: string, ok?: boolean) => {
    events.push({ kind, text: text.replace(/\s+/g, ' ').slice(0, 600), at: Date.now(), ...(ok === undefined ? {} : { ok }) });
    if (events.length > 100) events.shift();
  };

  try {
    for (let round = 0; round < Math.min(MAX_TOOL_ROUNDS, Math.max(1, workflow.maxSteps)); round += 1) {
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      useWorkflowRuntime.getState().updateProgress(workflow.id, { step: round + 1, tool: null });
      const result = await chat({ target, messages, tools: toolSchemas, signal: controller.signal });
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      steps += 1;
      trace('step', `Step ${round + 1}: ${result.toolCalls.length ? `${result.toolCalls.length} tool call(s)` : 'answer'}`);
      messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });
      finalText = result.content || finalText;

      if (!result.toolCalls.length) break;

      for (const call of result.toolCalls) {
        useWorkflowRuntime.getState().updateProgress(workflow.id, { tool: call.name });
        const write = !READ_ONLY_TOOLS.has(call.name);
        if (write && !workflow.allowWrites) {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: `This workflow is read-only: ${call.name} was not executed. Report the finding instead.`,
          });
          trace('tool', `${call.name} skipped (read-only)`, false);
          useWorkflowRuntime.getState().updateProgress(workflow.id, { tool: null });
          continue;
        }
        const outcome = await runTool(call.name, call.args ?? {});
        tools += 1;
        trace('tool', `${call.name} ${outcome.ok ? 'ok' : 'failed'} · ${outcome.summary}`, outcome.ok);
        messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
        useWorkflowRuntime.getState().updateProgress(workflow.id, { tool: null });
      }
    }
  } catch (error) {
    aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    failure = aborted
      ? 'Canceled by user.'
      : error instanceof ProviderError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    trace('error', failure, false);
  } finally {
    controllers.delete(workflow.id);
  }

  let issueKey: string | undefined;
  if (!failure && workflow.createIssue && finalText.trim()) {
    const issue = useData.getState().createIssue({
      title: `[${workflow.name}] ${titleFrom(finalText)}`.slice(0, 140),
      status: workflow.issueStatus ?? 'todo',
      priority: 'none',
    });
    useData.getState().addComment(issue.id, 'agent', finalText.trim());
    if (workflow.projectId) useData.getState().setProject(issue.id, workflow.projectId);
    useData.getState().addActivity(issue.id, 'agent', `Workflow “${workflow.name}”`, 'agent');
    issueKey = issue.key;
  }

  useWorkflowRuntime.getState().finish(workflow.id);

  if (!failure) trace('final', finalText.slice(0, 500) || 'Empty answer', true);

  const run = record({
    id: `run_${startedAt.toString(36)}`,
    at: startedAt,
    status: aborted ? 'canceled' : failure ? 'error' : 'ok',
    summary: (failure ? `${failure}\n${finalText}` : finalText).slice(0, 2_000),
    steps,
    tools,
    ms: Date.now() - startedAt,
    model: target.model,
    issueKey,
    events,
    ...(failure ? { error: failure } : {}),
  });

  if (aborted) {
    useUI.getState().pushToast({
      title: `${translate(getLocale(), 'Workflow canceled')} · ${workflow.name}`,
      tone: 'danger',
    });
  } else if (!failure) {
    useUI.getState().pushToast({
      title: `${translate(getLocale(), 'Workflow finished')} · ${workflow.name}`,
      description: issueKey
        ? translate(getLocale(), 'Report saved as {key}', { key: issueKey })
        : run.summary.slice(0, 120),
      tone: 'success',
    });
  }

  return run;
}

/* --------------------------------------------------------------- scheduler */

const RUN_KEY = 'aether:workflow:last-tick';
let timer: number | null = null;
let started = false;

/** Local-time schedule check. Manual workflows never fire on their own. */
import { workflowDue as isWorkflowDue } from './schedule';
export { isWorkflowDue };

async function tick() {
  if (typeof window === 'undefined') return;
  const workspace = useWorkspace.getState();
  if (!workspace.loaded || document.visibilityState !== 'visible') return;

  const lastTick = Number(window.localStorage.getItem(RUN_KEY) ?? 0);
  const now = Date.now();
  // one pass per minute at most, even with several tabs open
  if (now - lastTick < 55_000) return;
  window.localStorage.setItem(RUN_KEY, String(now));

  for (const workflow of workspace.workflows) {
    if (!isWorkflowDue(workflow, new Date(now))) continue;
    void runWorkflowNow(workflow);
  }
}

/**
 * Fire scheduled workflows while the app is open; the server keeps the history.
 *
 * Off by default: the headless server scheduler already scans once a minute,
 * and two schedulers would race the same window. Enable this only when the
 * server scheduler is disabled on purpose (AETHER_SCHEDULER=0):
 *   NEXT_PUBLIC_AETHER_BROWSER_SCHEDULER=1
 */
export function startWorkflowScheduler() {
  if (started || typeof window === 'undefined') return;
  if (process.env.NEXT_PUBLIC_AETHER_BROWSER_SCHEDULER !== '1') return;
  started = true;
  timer = window.setInterval(() => void tick(), 60_000);
  window.setTimeout(() => void tick(), 4_000);
}

export function stopWorkflowScheduler() {
  if (timer) window.clearInterval(timer);
  timer = null;
  started = false;
}
