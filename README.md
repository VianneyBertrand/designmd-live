# designmd-live

> Live editor for DESIGN.md — wired on your real codebase.

Tweak the tokens of your `DESIGN.md` in a side panel, watch your actual app re-render in the iframe next to it. No design system rebuild, no reload.

[![CI](https://github.com/VianneyBertrand/designmd-live/actions/workflows/ci.yml/badge.svg)](https://github.com/VianneyBertrand/designmd-live/actions/workflows/ci.yml)

## Try it on the bundled demo

```bash
git clone https://github.com/VianneyBertrand/designmd-live
cd designmd-live
pnpm install
pnpm build
```

Then in two terminals:

```bash
# Terminal A — the demo Tailwind v4 app (acts as the "user's project")
pnpm --filter @designmd-live/demo-target dev   # http://localhost:5174

# Terminal B — designmd-live in proxy mode pointed at the demo
node packages/cli/dist/index.js dev --proxy http://localhost:5174
```

Open **http://localhost:3030/__designmd-live/** — left panel edits the repo's `DESIGN.md`, the iframe shows the demo app reacting in real time.

## Use it on your own project

See [`packages/cli/README.md`](./packages/cli/README.md) for the published CLI documentation.

## Repository layout

```
designmd-live/
├── apps/
│   ├── panel/         # Vite + React 19 — the live editor UI
│   └── demo-target/   # Tailwind v4 sandbox to validate the loop
├── packages/
│   ├── cli/           # designmd-live npm package (Hono + WS broker)
│   └── core/          # DESIGN.md parser / serializer / DTCG schema
├── DESIGN.md          # The tool's own design tokens (dogfood)
├── SPEC.md            # Architecture + roadmap
└── CHANGELOG.md
```

## Stack

Turborepo · pnpm workspaces · TypeScript 5.9 · Node 24 · Vite 6 · React 19 · Tailwind v4 · Hono · ws · citty · Zod · Biome · Vitest.

## License

MIT — see [LICENSE](./LICENSE).
