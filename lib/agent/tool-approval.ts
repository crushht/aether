/** Whether a tool call waits for a person, given the workspace policy. */
export function needsToolApproval(input: {
  requireApproval: boolean;
  isReadOnly: boolean;
  allowed: readonly string[];
  name: string;
}): boolean {
  if (!input.requireApproval) return false;
  if (input.isReadOnly) return false;
  return !input.allowed.includes(input.name);
}
