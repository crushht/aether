/**
 * Precision presets: temperature and step budget are one decision, not two.
 *
 * A slider plus a number box asks a person to know what 0.35 and 14 steps do
 * together. The three presets name the three shapes people actually want, and
 * `presetFor` keeps the chips honest — a hand-tuned pair lights up "Custom"
 * instead of pretending to be one of them.
 */

export type PrecisionId = 'precise' | 'balanced' | 'creative';
export type PrecisionMatch = PrecisionId | 'custom';

export interface PrecisionProfile {
  id: PrecisionId;
  /** dictionary key, translated by the settings page */
  label: string;
  /** dictionary key: what this shape is for */
  hint: string;
  temperature: number;
  maxSteps: number;
}

export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1.5;
export const STEPS_MIN = 1;
export const STEPS_MAX = 20;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_STEPS = 8;
/** how close is close enough to call a hand-set number "this preset" */
const TEMPERATURE_TOLERANCE = 0.051;

export const PRECISION_PRESETS: PrecisionProfile[] = [
  {
    id: 'precise',
    label: 'Precise',
    hint: 'Repeatable edits and lookups: low temperature, few steps.',
    temperature: 0.1,
    maxSteps: 6,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'The default: enough room for a short plan, little wandering.',
    temperature: 0.3,
    maxSteps: 8,
  },
  {
    id: 'creative',
    label: 'Creative',
    hint: 'Drafting, naming, exploring: warmer and allowed more steps.',
    temperature: 0.7,
    maxSteps: 20,
  },
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 0 … 1.5, one decimal; anything unreadable becomes the default. */
export function clampTemperature(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TEMPERATURE;
  return round1(Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, numeric)));
}

/** 1 … 20 whole steps; anything unreadable becomes the default. */
export function clampSteps(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_STEPS;
  return Math.min(STEPS_MAX, Math.max(STEPS_MIN, Math.round(numeric)));
}

export function profileOf(id: PrecisionId): PrecisionProfile {
  return PRECISION_PRESETS.find((profile) => profile.id === id) ?? PRECISION_PRESETS[1];
}

/** The patch a click on a chip applies. Clamped, so a profile cannot drift out of range. */
export function applyPreset(id: PrecisionId): { temperature: number; maxSteps: number } {
  const profile = profileOf(id);
  return { temperature: clampTemperature(profile.temperature), maxSteps: clampSteps(profile.maxSteps) };
}

/**
 * Which chip describes this pair. Both halves must line up: 0.1 with 14 steps is
 * not "precise", it is the person's own choice and it should say so. The middle
 * preset matches the factory default (0.3 · 8), so a fresh provider is not "custom".
 */
export function presetFor(temperature: unknown, maxSteps: unknown): PrecisionMatch {
  const heat = clampTemperature(temperature);
  const steps = clampSteps(maxSteps);
  const match = PRECISION_PRESETS.find(
    (profile) => Math.abs(profile.temperature - heat) <= TEMPERATURE_TOLERANCE && profile.maxSteps === steps,
  );
  return match ? match.id : 'custom';
}

/** Tab through the presets: precise → balanced → creative → precise. */
export function nextPreset(current: PrecisionMatch): PrecisionId {
  if (current === 'custom') return 'balanced';
  const index = PRECISION_PRESETS.findIndex((profile) => profile.id === current);
  return PRECISION_PRESETS[(index + 1) % PRECISION_PRESETS.length].id;
}

/** One line for the settings summary, e.g. `Balanced · 0.3 · 12 steps`. */
export function describePrecision(temperature: unknown, maxSteps: unknown, customLabel = 'Custom'): string {
  const heat = clampTemperature(temperature);
  const steps = clampSteps(maxSteps);
  const match = presetFor(heat, steps);
  const name = match === 'custom' ? customLabel : profileOf(match).label;
  return `${name} · ${heat.toFixed(1)} · ${steps}`;
}
