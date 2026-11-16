// Build the desktop distributables.
//
//   1. next build                 → .next/standalone (a self-contained server)
//   2. copy static + public into it (Next does not do this for you)
//   3. electron-builder           → dist/*.exe (installer + portable)
//
// Usage: node scripts/build-desktop.mjs [--dir]
//   --dir  build an unpacked folder only (fast, for testing the shell)

import { spawnSync } from 'node:child_process';
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const dirOnly = process.argv.includes('--dir');

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    console.error(`\n✗ ${command} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('▸ building the Next app (standalone output)');
  run('npx', ['next', 'build']);

  if (!(await exists(standalone))) {
    console.error('✗ .next/standalone is missing — is `output: "standalone"` in next.config.mjs?');
    process.exit(1);
  }

  console.log('▸ copying .next/static and public into the standalone bundle');
  await cp(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true });
  if (await exists(path.join(root, 'public'))) {
    await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
  }

  // Next's file tracing follows the `fs` calls in the API routes and copies
  // the data directory into the bundle — never ship a workspace or an account
  // list inside an installer.
  await rm(path.join(standalone, '.data'), { recursive: true, force: true });
  await rm(path.join(root, 'dist'), { recursive: true, force: true });

  console.log('▸ packaging with electron-builder');
  run('npx', [
    'electron-builder',
    '--config',
    'electron-builder.yml',
    ...(dirOnly ? ['--dir'] : ['--win', 'nsis', 'portable']),
  ]);

  console.log('\n✓ done — see dist/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
