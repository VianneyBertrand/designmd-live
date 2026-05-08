# designmd-live

Live editor for `DESIGN.md` — wired on your real codebase.

## Usage

```bash
pnpm add -D designmd-live
npx designmd-live dev
```

Opens a panel at `http://localhost:3030`. The panel reads `DESIGN.md` from the current directory.

## Live preview

To see your real app react to token edits, add the agent script to your project (in dev only):

```tsx
// app/layout.tsx (Next.js example)
{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:3030/client.js" async />
)}
```

The agent connects to `ws://localhost:3030/ws`, receives token updates, and applies them as CSS variables on `:root`. Variable names follow Tailwind v4 conventions: `['color', 'brand', '500']` becomes `--color-brand-500`.

Then enter your dev server URL (e.g. `http://localhost:3000`) in the panel's preview pane.

## Flags

- `--port` — panel port (default 3030)
- `--cwd` — target project directory (default `process.cwd()`)

## Endpoints

- `GET /api/design-md` — read & parse the current DESIGN.md
- `POST /api/design-md` — write a new DESIGN.md (validated)
- `GET /client.js` — browser agent (inject in target project)
- `WS /ws` — broker (panel ↔ target apps)

## Status

Early scaffold. See the monorepo `SPEC.md`.
