import type { AgentWorkflow } from './types';

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Local-time schedule check shared by the browser runner and the headless
 * scheduler, so "daily at 9" means the same thing in both places.
 */
/** When the next scheduled run would fire (manual / paused → null). */
export function nextRunAt(workflow: AgentWorkflow, now = new Date()): Date | null {
  const trigger = workflow.trigger;
  if (!workflow.enabled || trigger.kind === 'manual') return null;

  if (trigger.kind === 'daily') {
    const at = new Date(now);
    at.setHours(trigger.hour ?? 9, 0, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  if (trigger.kind === 'weekly') {
    const at = new Date(now);
    at.setHours(trigger.hour ?? 9, 0, 0, 0);
    const target = trigger.weekday ?? 1;
    const current = now.getDay() === 0 ? 7 : now.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0 && at <= now) delta = 7;
    at.setDate(at.getDate() + delta);
    return at;
  }
  if (trigger.kind === 'interval') {
    if (!workflow.lastRunAt) return null;
    return new Date(workflow.lastRunAt + (trigger.minutes ?? 60) * 60_000);
  }
  return null;
}

/** `MM-DD HH:MM`, language-free so the same string works in both locales. */
export function formatNextRun(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function workflowDue(workflow: AgentWorkflow, now = new Date()) {
  if (!workflow.enabled) return false;
  const trigger = workflow.trigger;
  const last = workflow.lastRunAt ? new Date(workflow.lastRunAt) : null;

  if (trigger.kind === 'manual') return false;
  if (trigger.kind === 'daily') {
    if (now.getHours() < (trigger.hour ?? 9)) return false;
    return !last || !sameDay(last, now);
  }
  if (trigger.kind === 'weekly') {
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    if (weekday !== (trigger.weekday ?? 1)) return false;
    if (now.getHours() < (trigger.hour ?? 9)) return false;
    return !last || !sameDay(last, now);
  }
  if (trigger.kind === 'interval') {
    if (!last) return false;
    return now.getTime() - last.getTime() >= (trigger.minutes ?? 60) * 60_000;
  }
  return false;
}
