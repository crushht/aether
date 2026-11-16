/** What restoring a backup would add or drop, compared with the live workspace. */
export interface BackupDiffSide {
  added: string[];
  removed: string[];
  common: number;
}

export interface BackupDiff {
  issues: BackupDiffSide;
  projects: BackupDiffSide;
}

const keysOf = (items: Array<{ key?: string }> | undefined) =>
  new Set((items ?? []).map((item) => item?.key ?? '').filter(Boolean));

const namesOf = (items: Array<{ name?: string }> | undefined) =>
  new Set((items ?? []).map((item) => item?.name ?? '').filter(Boolean));

function side(backup: Set<string>, current: Set<string>): BackupDiffSide {
  const added: string[] = [];
  const removed: string[] = [];
  let common = 0;
  for (const item of backup) {
    if (current.has(item)) common += 1;
    else added.push(item);
  }
  for (const item of current) {
    if (!backup.has(item)) removed.push(item);
  }
  return { added, removed, common };
}

/**
 * `backup` is what the snapshot holds, `current` is what is live now.
 * `added` = restoring would bring these in, `removed` = they exist now but not
 * in the snapshot, so restoring would drop them.
 */
export function diffBackup(
  backup: { issues?: Array<{ key?: string }>; projects?: Array<{ name?: string }> },
  current: { issues?: Array<{ key?: string }>; projects?: Array<{ name?: string }> },
): BackupDiff {
  return {
    issues: side(keysOf(backup.issues), keysOf(current.issues)),
    projects: side(namesOf(backup.projects), namesOf(current.projects)),
  };
}

export function diffSummary(diff: BackupDiff, limit = 3): string[] {
  const lines: string[] = [];
  for (const [label, sideDiff] of [
    ['issue', diff.issues],
    ['project', diff.projects],
  ] as const) {
    if (sideDiff.added.length) {
      const shown = sideDiff.added.slice(0, limit).join(', ');
      lines.push(`+${sideDiff.added.length} ${label}(s): ${shown}${sideDiff.added.length > limit ? '…' : ''}`);
    }
    if (sideDiff.removed.length) {
      const shown = sideDiff.removed.slice(0, limit).join(', ');
      lines.push(`-${sideDiff.removed.length} ${label}(s): ${shown}${sideDiff.removed.length > limit ? '…' : ''}`);
    }
  }
  return lines;
}
