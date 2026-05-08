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
      description: 'Port for the panel (default: 3001)',
      default: '3001',
    },
    cwd: {
      type: 'string',
      description: 'Path to the target project (default: process.cwd())',
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const port = Number.parseInt(args.port, 10);
    const cwd = args.cwd;

    consola.start(`Starting designmd-live panel on http://localhost:${port}`);
    consola.info(`Watching DESIGN.md in: ${cwd}`);

    await startServer({ port, cwd });
  },
});
