const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Notification, screen, Tray } = require('electron');
const { sanitizeWindowState } = require('./window-state.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { pickUpdate } = require('./update.cjs');

/**
 * Desktop shell around the Next.js app (CommonJS: Electron cannot load ESM
 * from inside an asar archive).
 *
 * Dev (`npm run dev` running): loads http://127.0.0.1:4321.
 * Packaged: starts the bundled standalone server as a child process on a free
 * port, keeps its data in the OS app-data folder, then loads it.
 */

const isDev = !app.isPackaged;
const DEV_URL = process.env.LAB_DEV_URL ?? 'http://127.0.0.1:4321';

let serverProcess = null;
let mainWindow = null;
let serverUrl = null;

const userData = app.getPath('userData');
const dataDir = process.env.LAB_DATA_DIR ?? path.join(userData, 'data');
const stateFile = path.join(userData, 'window-state.json');
const updateFile = path.join(userData, 'update-state.json');
const mainLogFile = path.join(userData, 'main.log');

/**
 * The shell has no console on Windows, so an early crash used to leave nothing
 * behind. Everything unexpected lands in main.log next to the app data.
 */
function logMain(message) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.appendFileSync(mainLogFile, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    /* logging must never take the app down */
  }
}

process.on('uncaughtException', (error) => {
  logMain(`uncaughtException: ${error && error.stack ? error.stack : String(error)}`);
});
process.on('unhandledRejection', (reason) => {
  logMain(`unhandledRejection: ${reason && reason.stack ? reason.stack : String(reason)}`);
});
const UPDATE_URL = (process.env.AETHER_UPDATE_URL ?? '').replace(/\/+$/, '');

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(updateFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveUpdateState(patch) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(updateFile, JSON.stringify({ ...readUpdateState(), ...patch }), 'utf8');
  } catch {
    /* not fatal */
  }
}

/**
 * Check a static release manifest and offer the download. There is no silent
 * installer here: publishing and code signing are deployment decisions, and a
 * shell that installs unsigned binaries by itself would be worse than a link.
 */
async function checkForUpdates({ silent = false } = {}) {
  if (!UPDATE_URL) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Updates',
        message: 'No update source is configured.',
        detail: 'Set AETHER_UPDATE_URL to the folder that serves latest.json, then restart the app.',
      });
    }
    return null;
  }
  try {
    const response = await fetch(`${UPDATE_URL}/latest.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Update server returned ${response.status}.`);
    const manifest = await response.json();
    saveUpdateState({ lastCheckAt: Date.now() });
    const update = pickUpdate(manifest, app.getVersion());
    if (!update) {
      if (!silent) {
        dialog.showMessageBox({
          type: 'info',
          title: 'Updates',
          message: 'Aether is up to date.',
          detail: `This build is ${app.getVersion()}.`,
        });
      }
      return null;
    }
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Aether ${update.version} is available.`,
      detail: update.notes || `You are on ${app.getVersion()}.`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) void shell.openExternal(update.url);
    return update;
  } catch (error) {
    if (!silent) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Updates',
        message: 'Could not check for updates.',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

/** One silent check per day at most; the menu always checks immediately. */
function scheduleUpdateCheck() {
  const { lastCheckAt } = readUpdateState();
  if (Date.now() - (Number(lastCheckAt) || 0) < 24 * 60 * 60 * 1000) return;
  setTimeout(() => void checkForUpdates({ silent: true }), 10_000);
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed;
  } catch {
    /* first run */
  }
  return { width: 1440, height: 900 };
}

function saveState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() }), 'utf8');
  } catch {
    /* not fatal */
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.once('listening', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.listen(0, '127.0.0.1');
  });
}

async function waitForServer(url, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`The app server exited with code ${serverProcess.exitCode}.`);
    }
    try {
      const response = await fetch(`${url}/api/auth`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The app server did not start in time.');
}

async function startBundledServer() {
  const root = path.join(process.resourcesPath, 'server');
  const entry = path.join(root, 'server.js');
  if (!fs.existsSync(entry)) throw new Error(`Bundled server missing at ${entry}`);

  const port = await freePort();
  serverUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      // run the Electron binary as a plain Node process
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      LAB_DATA_DIR: dataDir,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logFile = path.join(userData, 'server.log');
  try {
    fs.mkdirSync(userData, { recursive: true });
    const stream = fs.createWriteStream(logFile, { flags: 'a' });
    serverProcess.stdout?.pipe(stream);
    serverProcess.stderr?.pipe(stream);
  } catch {
    /* logging is best effort */
  }

  await waitForServer(serverUrl);
  return serverUrl;
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New issue',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }))`,
          ),
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.executeJavaScript(
            `window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`,
          ),
        },
        { type: 'separator' },
        {
          label: 'Open data folder',
          click: () => void shell.openPath(dataDir),
        },
        {
          label: 'Check for updates…',
          click: () => void checkForUpdates(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url) {
  const state = sanitizeWindowState(
    readState(),
    screen.getAllDisplays().map((display) => display.workArea),
  );
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#F7F8F8',
    autoHideMenuBar: true,
    title: 'Aether',
    // the app draws its own top bar; the window keeps native controls in the corner
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'win32'
      ? { titleBarOverlay: { color: '#FFFFFF', symbolColor: '#5B6069', height: 44 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', saveState);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // links that leave the app open in the real browser
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(url) || target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) return;
    event.preventDefault();
    void shell.openExternal(target);
  });

  void mainWindow.loadURL(url);
  return mainWindow;
}

let tray = null;
let pendingDeepLink = null;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * `aether://issue/<id>` and `aether://open?issue=<id>&project=<id>` both land
 * here. The window may still be loading on a cold start, so the payload waits
 * for did-finish-load instead of being dropped.
 */
function handleDeepLink(rawUrl) {
  let payload = null;
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'issue' || url.hostname === 'open') {
      const issueId = url.hostname === 'issue'
        ? decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        : url.searchParams.get('issue');
      const projectId = url.searchParams.get('project');
      if (issueId) payload = { issueId, projectId };
      else if (projectId) payload = { projectId };
    }
  } catch {
    return;
  }
  if (!payload) return;

  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) pendingDeepLink = payload;
  else mainWindow.webContents.send('aether:deeplink', payload);
}

function deepLinkFromArgv(argv) {
  return (argv ?? []).find((arg) => typeof arg === 'string' && arg.startsWith('aether://'));
}

function registerProtocol() {
  try {
    if (isDev && process.defaultApp) {
      // dev: electron.exe <project> aether://… — Windows needs both to route.
      app.setAsDefaultProtocolClient('aether', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('aether');
    }
  } catch {
    /* no registry access: deep links simply stay unavailable */
  }
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, 'tray.png');
    const image = fs.existsSync(iconPath) ? require('electron').nativeImage.createFromPath(iconPath) : null;
    if (!image || image.isEmpty()) {
      logMain('tray icon missing: desktop/tray.png');
      return;
    }
    tray = new Tray(image);
    tray.setToolTip('Aether');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Aether', click: () => showMainWindow() },
        {
          label: 'Minimize to tray',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (error) {
    logMain(`tray unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
    else showMainWindow();
  });

  // macOS delivers protocol opens as an event, not as argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  ipcMain.handle('aether:notify', (_event, payload) => {
  if (!Notification.isSupported()) return false;
  const title = String(payload && payload.title ? payload.title : '').slice(0, 120);
  const body = String(payload && payload.body ? payload.body : '').slice(0, 300);
  if (!title) return false;
  try {
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('aether:notification-click', {
        issueId: payload && payload.issueId ? String(payload.issueId) : null,
        projectId: payload && payload.projectId ? String(payload.projectId) : null,
      });
    });
    notification.show();
    return true;
  } catch {
    return false;
  }
});

app.whenReady().then(async () => {    if (process.platform === 'win32') app.setAppUserModelId('dev.linearlab.desktop');
    try {
      const url = isDev ? DEV_URL : await startBundledServer();
      buildMenu();
      createWindow(url);
      createTray();
      registerProtocol();
      mainWindow.webContents.on('did-finish-load', () => {
        if (pendingDeepLink) {
          mainWindow.webContents.send('aether:deeplink', pendingDeepLink);
          pendingDeepLink = null;
        }
      });
      const launchLink = deepLinkFromArgv(process.argv);
      if (launchLink) handleDeepLink(launchLink);
      scheduleUpdateCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logMain(`startup failed: ${message}`);
      dialog.showErrorBox('Aether could not start', `${message}\n\nLogs: ${mainLogFile}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void (async () => {
        const url = isDev ? DEV_URL : serverUrl ?? (await startBundledServer());
        createWindow(url);
      })();
    }
  });

  app.on('before-quit', () => {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
}
