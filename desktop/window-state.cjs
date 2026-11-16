'use strict';

/** Keep a remembered window on screen; a removed monitor must not hide it. */
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function sanitizeWindowState(state, workAreas) {
  const areas = Array.isArray(workAreas) && workAreas.length ? workAreas : [{ x: 0, y: 0, width: 1440, height: 900 }];
  const primary = areas[0];
  const raw = state && typeof state === 'object' ? state : {};
  const width = Math.max(MIN_WIDTH, Math.min(Number(raw.width) || 1440, primary.width));
  const height = Math.max(MIN_HEIGHT, Math.min(Number(raw.height) || 900, primary.height));
  const maximized = Boolean(raw.maximized);
  const hasPosition = Number.isFinite(raw.x) && Number.isFinite(raw.y);
  if (!hasPosition) return { width, height, maximized };
  const x = Math.round(raw.x);
  const y = Math.round(raw.y);
  const visible = areas.some(
    (area) => x + width > area.x && x < area.x + area.width && y + height > area.y && y < area.y + area.height,
  );
  return visible ? { width, height, x, y, maximized } : { width, height, maximized };
}

module.exports = { sanitizeWindowState, MIN_WIDTH, MIN_HEIGHT };
