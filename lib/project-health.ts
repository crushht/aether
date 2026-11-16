import type { Project, ProjectUpdate } from '@/lib/types';

export interface HealthPoint {
  at: number;
  health: NonNullable<ProjectUpdate['health']>;
  updateId: string;
}

/**
 * Health observations from posted updates, oldest first. Updates without an
 * explicit health inherit nothing: a missing observation is not a data point.
 */
export function healthSeries(project: Project): HealthPoint[] {
  return (project.updates ?? [])
    .filter((update) => Boolean(update.health))
    .map((update) => ({
      at: +new Date(update.createdAt) || 0,
      health: update.health as NonNullable<ProjectUpdate['health']>,
      updateId: update.id,
    }))
    .sort((a, b) => a.at - b.at);
}

/** Vertical slots for the three states, used by the trend line. */
export const HEALTH_Y: Record<string, number> = {
  on_track: 8,
  at_risk: 22,
  off_track: 36,
};

export const HEALTH_COLOR: Record<string, string> = {
  on_track: 'var(--green)',
  at_risk: 'var(--orange)',
  off_track: 'var(--red)',
};
