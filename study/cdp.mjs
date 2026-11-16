// Minimal CDP client using Node's built-in WebSocket (Node >= 22). No deps.
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CANDIDATES =
  process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];

export const CHROME = process.env.AETHER_CHROME || CANDIDATES.find((candidate) => existsSync(candidate)) || CANDIDATES[0];
const PORT = 9333;

export async function launch({ port = PORT, profile } = {}) {
  const userDataDir = profile || path.join(process.env.TEMP || '.', 'cdp-study-profile');
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--disable-features=DialMediaRouteProvider,Translate',
    '--font-render-hinting=none',
    '--force-color-profile=srgb',
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });
  // wait for endpoint
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, port, info: await r.json() };
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('chrome did not expose debugging port');
}

export class Session {
  constructor(ws, id = 0) {
    this.ws = ws;
    this.nextId = id;
    this.pending = new Map();
    this.sessionId = null;
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 60000);
    });
  }
}

export async function connect(port = PORT) {
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tabs.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  return new Session(ws);
}

export async function newPage(port = PORT) {
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const s = new Session(ws);
  const { targetId } = await s.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await s.send('Target.attachToTarget', { targetId, flatten: true });
  s.sessionId = sessionId;
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  return s;
}

export async function viewport(s, width, height, scale = 1) {
  await s.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: width < 500,
  });
}

export async function goto(s, url, settle = 3500) {
  await s.send('Page.navigate', { url });
  // wait for load event
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const ok = s.events.some((e) => e.method === 'Page.loadEventFired');
    if (ok) break;
  }
  await new Promise((r) => setTimeout(r, settle));
}

export async function evaluate(s, expression) {
  const res = await s.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 800));
  return res.result.value;
}

export async function shot(s, file, { fullPage = false, width = 1440, height = 900 } = {}) {
  let params = { format: 'png' };
  if (fullPage) {
    const metrics = await s.send('Page.getLayoutMetrics');
    const cs = metrics.cssContentSize || metrics.contentSize;
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 16000), scale: 1 },
    };
  }
  const { data } = await s.send('Page.captureScreenshot', params);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}

export async function saveJson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
  return file;
}
