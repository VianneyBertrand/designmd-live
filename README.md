# designmd-live

> Live editor for DESIGN.md — wired on your real codebase.

Tweak the tokens of your `DESIGN.md`, watch your actual components re-render. Switch between multiple DESIGN.md files to compare skins live.

## Status

Early scaffold. See [SPEC.md](./SPEC.md) for the full plan.

## Stack

- Turborepo monorepo (pnpm workspaces)
- `apps/landing` — Next.js 16 (marketing site)
- `apps/panel` — Vite + React 19 (dev panel)
- `packages/cli` — CLI distributed on npm (tsup + citty + Hono)
- `packages/core` — DESIGN.md parser, types, validation (Zod)
- `packages/ui` — shadcn primitives shared across panel and landing

Tooling: Biome (lint + format), Vitest (tests), Node 24 LTS, pnpm.

## Develop

```bash
pnpm install
pnpm dev
```
