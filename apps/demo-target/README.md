# @designmd-live/demo-target

A small Tailwind v4 + React app to validate the live-token loop end-to-end.

It is **not published**, it is a workspace-local sandbox so you can:

1. Edit a token in the `designmd-live` panel.
2. Watch this app's hero / cards / buttons react in real time.

## Run the full demo

From the repo root, you need three terminals (or one terminal + tmux):

```bash
# 1. Build everything once
pnpm build

# 2. Terminal A — start the demo target on :5174
pnpm --filter @designmd-live/demo-target dev

# 3. Terminal B — start designmd-live in proxy mode
node packages/cli/dist/index.js dev --proxy http://localhost:5174
```

Then open **http://localhost:3030/__designmd-live/** — the panel iframes the demo. Tweak `color.brand.500` in the panel and watch the hero, buttons, badges, and avatars on the demo update instantly.

## What's inside

- `src/styles.css` — Tailwind v4 `@theme {}` defaults that mirror the repo's `DESIGN.md` token names. The agent overrides these at runtime via a higher-specificity `<style>` block on `:root`.
- `src/app.tsx` — A modest landing-style layout (header, hero, feature grid, activity card, footer) that exercises every token category: color, spacing, radius. Typography family is browser default.

## Why this matters

If you point `--proxy` at a project whose CSS vars **don't** match the DESIGN.md token paths, nothing visible will change. This demo is the canonical reference for "what a project should look like to take advantage of designmd-live".
