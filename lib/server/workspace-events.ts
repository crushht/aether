/**
 * A tiny in-process event bus for workspace changes. One server instance owns
 * the files; SSE clients subscribe to the scope they can read (the shared file
 * or their personal one). Multi-instance deployments would replace this with
 * a database-backed channel, which is why nothing here assumes durability.
 */

export interface WorkspaceChange {
  scope: string;
  updatedAt: number;
  actorId: string;
}

type Listener = (change: WorkspaceChange) => void;

const globalStore = globalThis as unknown as { __aetherWorkspaceListeners?: Set<Listener> };
const listeners = (globalStore.__aetherWorkspaceListeners ??= new Set<Listener>());

export function publishWorkspaceChange(change: WorkspaceChange) {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      /* a broken stream must not stop the others */
    }
  }
}

export function subscribeWorkspace(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
