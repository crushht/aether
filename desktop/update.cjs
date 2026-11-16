/**
 * Pure update-manifest helpers for the desktop shell. Kept separate from
 * Electron so they can be tested with plain Node.
 *
 * Manifest shape (served at `${AETHER_UPDATE_URL}/latest.json`):
 *   { "version": "0.4.0", "url": "https://…/Aether-0.4.0-x64.exe", "notes": "…" }
 */

function parse(version) {
  const match = String(version ?? '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

/** >0 when a is newer than b, 0 equal, <0 older; invalid versions sort last. */
function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** The usable newer release, or null when there is none (or the manifest is bad). */
function pickUpdate(manifest, currentVersion) {
  if (!manifest || typeof manifest !== 'object') return null;
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  const url = typeof manifest.url === 'string' ? manifest.url.trim() : '';
  if (!version || !url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (compareVersions(version, currentVersion) <= 0) return null;
  return {
    version,
    url,
    notes: typeof manifest.notes === 'string' ? manifest.notes.slice(0, 2_000) : '',
  };
}

module.exports = { compareVersions, pickUpdate };
