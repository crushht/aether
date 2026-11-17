'use client';

import { peopleNow } from './people';
import { useData } from './store/data';
import type { QueryContext } from './query';

/**
 * Everything the query language needs to turn `assignee:me` or `label:Bug`
 * into a match: the signed-in account, people, labels, projects and cycles.
 * Read on demand from the stores, so a caller never has to thread it down.
 */
export function queryContext(): QueryContext {
  const data = useData.getState();
  const people = peopleNow();
  return {
    meId: people.me?.id ?? null,
    personName: (id) => people.users.find((user) => user.id === id)?.name,
    labelName: (id) => data.labels.find((label) => label.id === id)?.name,
    projectName: (id) => data.projects.find((project) => project.id === id)?.name,
    cycleName: (id) => data.cycles.find((cycle) => cycle.id === id)?.name,
  };
}
