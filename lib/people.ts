'use client';

import * as React from 'react';
import type { PublicUser } from './types';
import { useSession } from './session';
import { users as seedUsers } from './mock-data';

const SEED: PublicUser[] = seedUsers;

/**
 * One place to read "who is in this workspace and which one is me".
 *
 * Old snapshots stored the placeholder id `me`; that alias still resolves to
 * the workspace owner so existing issues keep their assignee.
 */
export function usePeople() {
  const users = useSession((s) => s.users);
  const me = useSession((s) => s.user);

  const list = users.length ? users : SEED;

  const userById = React.useMemo(() => {
    const map = new Map<string, PublicUser>();
    for (const user of list) map.set(user.id, user);
    if (!map.has('me') && list[0]) map.set('me', list[0]);
    return map;
  }, [list]);

  return { users: list, userById, meId: me?.id ?? 'me', me };
}

const FALLBACK: PublicUser = {
  id: 'me',
  name: '我',
  handle: 'me',
  role: 'owner',
  color: '#5E6AD2',
};

/** Non-hook access for stores and tools. */
export function peopleNow(): { users: PublicUser[]; userById: Map<string, PublicUser>; meId: string; me: PublicUser } {
  const state = useSession.getState();
  const list = state.users.length ? state.users : SEED;
  const userById = new Map(list.map((user) => [user.id, user]));
  if (!userById.has('me') && list[0]) userById.set('me', list[0]);
  const me = state.user ?? list[0] ?? FALLBACK;
  return { users: list, userById, meId: me.id, me };
}

/** Resolve an id that may be stale (a removed member, or the legacy `me`). */
export function resolvePerson(id: string | null | undefined): PublicUser | null {
  if (!id) return null;
  return peopleNow().userById.get(id) ?? null;
}
