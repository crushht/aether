// Start the Next dev server and the Electron shell together.
//
//   npm run desktop:dev
//
// The shell waits for http://127.0.0.1:4321 before opening a window, so you can
// edit the UI and see it without restarting Electron.

import { spawn } from 'node:child_process';
import process from 'node:process';

const PORT = process.env.PORT ?? '4321';
const url = `http://127.0.0.1:${PORT}`;
const shell = process.platform === 'win32';

const dev = spawn('npx', ['next', 'dev', '-p', PORT], { stdio: 'inherit', shell });

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${url}/api/auth`, { cache: 'no-store' });
      if (response.ok) return true;
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const ready = await waitForServer();
if (!ready) {
  console.error(`✗ dev server did not answer on ${url}`);
  dev.kill();
  process.exit(1);
}

const env = { ...process.env, LAB_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;

const electron = spawn(process.execPath, ['scripts/run-electron.mjs'], {
  stdio: 'inherit',
  shell: false,
  env,
});

const stop = () => {
  electron.kill();
  dev.kill();
};
electron.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
