const { contextBridge, ipcRenderer } = require('electron');

// Expose the flag first: everything else in this file is cosmetic.
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  notify: (title, body, payload) =>
    ipcRenderer.invoke('aether:notify', {
      title: String(title ?? ''),
      body: String(body ?? ''),
      issueId: payload && payload.issueId ? String(payload.issueId) : null,
      projectId: payload && payload.projectId ? String(payload.projectId) : null,
    }),
  onNotificationClick: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('aether:notification-click', listener);
    return () => ipcRenderer.removeListener('aether:notification-click', listener);
  },
  /** aether://issue/<id> and aether://open?issue=<id> arrive here. */
  onDeepLink: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('aether:deeplink', listener);
    return () => ipcRenderer.removeListener('aether:deeplink', listener);
  },
});

// At preload time the document may not have a documentElement yet — a throw
// here used to abort the whole preload and take the bridge with it.
function markDesktop() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.dataset.desktop = '1';
    }
  } catch {
    /* nothing to mark yet */
  }
}

markDesktop();
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markDesktop, { once: true });
  else markDesktop();
  window.addEventListener('load', markDesktop, { once: true });
}
