export interface NotificationClickPayload {
  issueId?: string | null;
  projectId?: string | null;
}

/** Where a clicked desktop notification should take the app. */
export function routeForNotification(
  payload: NotificationClickPayload | null | undefined,
): { kind: 'project'; id: string } | { kind: 'issue'; id: string } | null {
  if (!payload) return null;
  const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  if (projectId) return { kind: 'project', id: projectId };
  const issueId = typeof payload.issueId === 'string' ? payload.issueId.trim() : '';
  if (issueId) return { kind: 'issue', id: issueId };
  return null;
}
