# designmd-live

Live editor for `DESIGN.md` — wired on your real codebase.

Tweak the tokens of your `DESIGN.md` in a side panel, watch your actual app re-render in the iframe next to it. No design system rebuild, no reload.

## Install

```bash
pnpm add -D designmd-live
```

## Quick start (recommended)

The simplest way: let the CLI proxy your dev server.

```bash
# 1. Make sure your app is running, e.g. pnpm dev → http://localhost:3000
# 2. In another terminal, from the same project:
npx designmd-live dev --proxy http://localhost:3000
# → opens http://localhost:3030
```

What happens:
- `http://localhost:3030/` reverse-proxies your dev server.
- The agent script is auto-injected into every HTML response.
- `http://localhost:3030/__designmd-live/` is the live editor panel.
- The panel iframes the proxy, so token edits hot-swap your real components.

**No code changes required in your project.**

## Manual mode (no proxy)

If you'd rather not proxy (e.g. you want to view the panel and your app side-by-side at their original URLs), add the agent script to your project's `<head>` in dev only:

```tsx
// app/layout.tsx (Next.js App Router)
{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:3030/client.js" async />
)}
```

Then run:

```bash
npx designmd-live dev
# Panel: http://localhost:3030
# In the panel, point the preview iframe at your app URL (e.g. http://localhost:3000).
```

## Bootstrap a starter

```bash
npx designmd-live init
```

Creates a starter `DESIGN.md` in the current directory with sane defaults (color, typography, spacing, radius). Use `--force` to overwrite an existing file.

## How tokens map to CSS

Tokens in your `DESIGN.md` are converted to CSS custom properties on `:root`, with the path joined by `-`:

| DESIGN.md | CSS variable |
|---|---|
| `color.background` | `--color-background` |
| `color.brand.500` | `--color-brand-500` |
| `spacing.4` | `--spacing-4` |
| `radius.lg` | `--radius-lg` |

This matches Tailwind v4's `@theme {}` convention out of the box. If your project uses Tailwind v4, your tokens will already be exposed under matching variable names — the agent simply overrides them in a higher-specificity `<style>` block.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--port` | `3030` | Port for the panel and proxy |
| `--cwd` | `process.cwd()` | Where to read/write `DESIGN.md` |
| `--proxy` | _(none)_ | Reverse-proxy a dev server URL |

## Endpoints

- `GET /` — proxy target (with `--proxy`) or redirect to the panel
- `GET /__designmd-live/` — panel UI
- `GET /api/config` — runtime config (proxy info, panel path)
- `GET /api/design-md` — read & parse the current DESIGN.md
- `POST /api/design-md` — write a new DESIGN.md (validated)
- `GET /client.js` — browser agent (auto-injected in proxy mode)
- `WS /ws` — broker (panel ↔ target apps)

## Requirements

- Node.js 24+
- A project that uses CSS custom properties for design tokens. Tailwind v4 with `@theme` is the most direct fit; any framework that consumes `:root { --foo: ... }` will work.

## License

MIT
