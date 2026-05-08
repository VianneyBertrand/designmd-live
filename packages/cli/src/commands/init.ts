import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand } from 'citty';
import { consola } from 'consola';

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Scaffold a starter DESIGN.md in the current directory',
  },
  args: {
    cwd: {
      type: 'string',
      description: 'Target directory (default: process.cwd())',
      default: process.cwd(),
    },
    force: {
      type: 'boolean',
      description: 'Overwrite an existing DESIGN.md',
      default: false,
    },
  },
  async run({ args }) {
    const target = join(args.cwd, 'DESIGN.md');

    if (existsSync(target) && !args.force) {
      consola.warn(`DESIGN.md already exists at ${target}`);
      consola.info('Re-run with --force to overwrite.');
      process.exit(1);
    }

    await writeFile(target, STARTER, 'utf8');
    consola.success(`Created ${target}`);
    consola.info('Next steps:');
    consola.info('  • Edit the tokens above to match your brand.');
    consola.info('  • Run `designmd-live dev` to open the live panel.');
    consola.info('  • Or `designmd-live dev --proxy http://localhost:3000` to wire a real app.');
  },
});

const STARTER = `---
color:
  background:
    $value: oklch(1 0 0)
    $type: color
    $description: Default page background
  foreground:
    $value: oklch(0.15 0 0)
    $type: color
    $description: Default text color
  brand:
    50:
      $value: oklch(0.97 0.02 250)
      $type: color
    500:
      $value: oklch(0.65 0.18 250)
      $type: color
      $description: Primary brand color
    900:
      $value: oklch(0.25 0.12 250)
      $type: color
  muted:
    $value: oklch(0.96 0 0)
    $type: color
  border:
    $value: oklch(0.92 0 0)
    $type: color

typography:
  family:
    sans:
      $value:
        - Inter
        - system-ui
        - sans-serif
      $type: fontFamily
    mono:
      $value:
        - JetBrains Mono
        - ui-monospace
        - monospace
      $type: fontFamily

spacing:
  1:
    $value: 0.25rem
    $type: dimension
  2:
    $value: 0.5rem
    $type: dimension
  4:
    $value: 1rem
    $type: dimension
  6:
    $value: 1.5rem
    $type: dimension
  8:
    $value: 2rem
    $type: dimension

radius:
  sm:
    $value: 0.25rem
    $type: dimension
  md:
    $value: 0.5rem
    $type: dimension
  lg:
    $value: 0.75rem
    $type: dimension
---

# Design System

Document the **why** behind your tokens here.

## Brand voice

Describe the personality of your product in two or three sentences.

## Usage

- \`color.foreground\` for body copy.
- \`color.brand.500\` reserved for primary CTAs and active states.
- Spacing scale follows a 0.25rem base — don't introduce raw pixels.
`;
