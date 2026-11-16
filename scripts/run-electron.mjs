// Launch the desktop shell.
//
// Some environments set ELECTRON_RUN_AS_NODE=1 for unrelated reasons; with it
// set, the Electron binary runs as plain Node and never opens a window, so this
// wrapper clears it before spawning.

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const electron = (await import('electron')).default;
const args = process.argv.slice(2);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(process.cwd()), ...args], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
