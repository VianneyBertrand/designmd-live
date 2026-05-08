# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-05-08

Initial release.

### Added

- `designmd-live dev` — single-port local server combining the React panel,
  REST API, WebSocket broker, and an optional reverse-proxy for the user's
  dev server.
- `designmd-live init` — scaffold a starter `DESIGN.md` with sane defaults
  (color, typography, spacing, radius).
- `--proxy <url>` — reverse-proxies any localhost dev server and auto-injects
  the live agent script into HTML responses. **No code changes required in
  the target project.**
- Manual mode: drop `<script src="http://localhost:3030/client.js" async>`
  into your project for live token edits without the proxy.
- Token tree side panel with click-to-edit color swatches, inline value
  inputs, validation, and Save button.
- Live preview iframe co-located with the panel; tokens hot-swap as
  CSS custom properties on `:root` (Tailwind v4 conventions).
- File watcher: external edits to `DESIGN.md` propagate instantly to all
  connected clients (other panels, target apps).
- WebSocket connection status indicator in the panel header.
- External-change banner when the file changes on disk while you have
  unsaved edits in the panel.

### Stack

- Turborepo monorepo (pnpm workspaces, Biome, TypeScript 5.9)
- `apps/panel` — Vite 6 + React 19 + Tailwind v4
- `packages/cli` — Hono + WebSocket + tsup, runs on Node 24
- `packages/core` — DESIGN.md parser/serializer (DTCG schema, Zod-validated)
