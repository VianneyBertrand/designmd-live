import { defineCommand, runMain } from 'citty';
import { devCommand } from './commands/dev.ts';
import { initCommand } from './commands/init.ts';

const main = defineCommand({
  meta: {
    name: 'designmd-live',
    version: '0.0.0',
    description: 'Live editor for DESIGN.md, wired on your real codebase',
  },
  subCommands: {
    dev: devCommand,
    init: initCommand,
  },
});

runMain(main);
