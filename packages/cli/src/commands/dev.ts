import { defineCommand } from 'citty';
import { consola } from 'consola';
import { startServer } from '../server.ts';

export const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: 'Start the local dev panel on http://localhost:<port>',
  },
  args: {
    port: {
      type: 'string',
      description: 'Port for the panel (default: 3030)',
      default: '3030',
    },
    cwd: {
      type: 'string',
      description: 'Path to the target project (default: process.cwd())',
      default: process.cwd(),
    },
    proxy: {
      type: 'string',
      description:
        'Reverse-proxy a dev server URL and auto-inject the agent (e.g. http://localhost:3000)',
    },
  },
  async run({ args }) {
    const port = Number.parseInt(args.port, 10);
    const cwd = args.cwd;
    const proxy = args.proxy ?? null;

    consola.start(`Starting designmd-live on http://localhost:${port}`);
    consola.info(`Watching DESIGN.md in: ${cwd}`);

    await startServer({ port, cwd, proxy });
  },
});
