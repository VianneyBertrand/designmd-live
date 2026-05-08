# designmd-live

Live editor for `DESIGN.md` — wired on your real codebase.

## Usage

```bash
pnpm add -D designmd-live
npx designmd-live dev
```

Opens a panel at `http://localhost:3030`. The panel reads `DESIGN.md` from the current directory.

## Flags

- `--port` — panel port (default 3030)
- `--cwd` — target project directory (default `process.cwd()`)

## Status

Early scaffold. See the monorepo `SPEC.md`.
