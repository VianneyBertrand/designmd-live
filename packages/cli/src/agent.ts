import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(__dirname, 'client', 'agent.js');

export function getAgentScript(): string {
  if (existsSync(BUNDLE_PATH)) {
    return readFileSync(BUNDLE_PATH, 'utf8');
  }
  return '/* designmd-live agent bundle missing — run `pnpm build` */';
}
