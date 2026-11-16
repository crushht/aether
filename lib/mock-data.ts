import type { Cycle, Issue, Label, Project, Team, User } from './types';

/**
 * A brand-new workspace: one person, one team, no content.
 * Issues, labels, projects, cycles and notifications live in the data store
 * and are persisted (server snapshot + browser cache), so the app never ships
 * demo issues or fake teammates.
 */
/**
 * "Today" for seeded dates: the current day at 20:00 local time. Pinning the
 * clock to a fixed calendar day made roadmaps and cycles stale; anchoring to
 * today keeps the seed readable while staying stable across SSR and hydration.
 */
const seedDay = new Date();
export const NOW = new Date(
  seedDay.getFullYear(),
  seedDay.getMonth(),
  seedDay.getDate(),
  20,
  0,
  0,
).getTime();

export const meId = 'me';

export const users: User[] = [
  { id: 'me', name: '我', handle: 'me', role: '创建者', color: '#5E6AD2', online: true },
];

export const userById = new Map(users.map((user) => [user.id, user]));

/** The product's own agent identity — not a workspace member, so it never
 *  shows up in assignee pickers or the members list. */
export const agentUser: User = { id: 'agent', name: 'Agent', handle: 'agent', role: '智能体', color: '#B87CF0' };

export const labels: Label[] = [];
export const labelById = new Map(labels.map((label) => [label.id, label]));

export const teams: Team[] = [
  { id: 'eng', key: 'ENG', name: '工程', color: '#5E6AD2', icon: 'engineering', memberIds: [meId] },
];

export const teamByKey = new Map(teams.map((team) => [team.key.toLowerCase(), team]));

/** No seed content: everything below starts empty on purpose. */
export const initialIssues: Issue[] = [];
export const initialProjects: Project[] = [];
export const initialCycles: Cycle[] = [];
