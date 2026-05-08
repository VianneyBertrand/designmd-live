#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..', '..');
const PANEL_DIST = resolve(REPO_ROOT, 'apps', 'panel', 'dist');
const CLI_DIST = resolve(CLI_ROOT, 'dist');
const TARGET_PANEL = join(CLI_DIST, 'panel');

function run(cmd, args, cwd) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  await rm(CLI_DIST, { recursive: true, force: true });
  await mkdir(CLI_DIST, { recursive: true });

  console.log('▸ Building tsup bundle');
  await run('pnpm', ['build:tsup'], CLI_ROOT);

  if (!existsSync(PANEL_DIST)) {
    console.warn(`! No panel dist found at ${PANEL_DIST}`);
    console.warn(
      '  Run `pnpm --filter @designmd-live/panel build` first, or `pnpm build` from the repo root.',
    );
    process.exit(1);
  }

  console.log('▸ Copying panel/dist → cli/dist/panel');
  await cp(PANEL_DIST, TARGET_PANEL, { recursive: true });

  // Mirror the root LICENSE into the package so npm picks it up on publish.
  const rootLicense = resolve(REPO_ROOT, 'LICENSE');
  if (existsSync(rootLicense)) {
    await cp(rootLicense, join(CLI_ROOT, 'LICENSE'));
    console.log('▸ Synced LICENSE');
  }

  console.log('✓ CLI build done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
