# Gap token swapper — design

## Goal

Two distinct edit operations co-exist in the inspect panel:

1. **Swap token at this location** (new): change which Tailwind utility a JSX element uses (`mt-6` → `mt-4`). Local to this spot. Persisted in source code.
2. **Redefine token value globally** (existing): change the value of a spacing token in `DESIGN.md` (`spacing.4: 2rem` → `1.5rem`). Affects all consumers.

Phase 1 scope: implement (1) for **gap edits only** (the inter-element overlay we just built). Padding/margin/color come later.

(2) already exists in infra (`emitTokenUpdate` writes `DESIGN.md`); we just make the value editable inline.

## Architecture

Three pieces:

### 1. Vite plugin — source location injection

A custom Vite plugin (or `babel-plugin-transform-react-jsx-source` config) injects a `data-loc` attribute on every JSX element in dev mode:

```tsx
<div className="mt-6">  →  <div className="mt-6" data-loc="src/components/Hero.tsx:42:8">
```

Lives in `apps/demo-target/vite.config.ts` initially. If proves out, ship as part of the CLI/SDK.

### 2. Browser agent — utility detection + edit emission

When the user picks a token in the gap panel:

- Read `data-loc` from the source element of the gap (the one whose `margin-top` / `margin-bottom` / `gap` produces the visible space).
- Identify the Tailwind utility on that element's `classList` that matches the targeted CSS prop. Match by inverse mapping: parse classes like `mt-{n}`, `mb-{n}`, `gap-{n}`, `gap-x-{n}`, `gap-y-{n}`, `space-y-{n}`, etc., compute their CSS value (using `getComputedStyle` on a sandbox or a static Tailwind scale table), pick the one matching.
- Emit a WS message `swap-utility` to the CLI server.

### 3. CLI server — file edit

On `swap-utility`:

- Open `data-loc` file, locate the line.
- Find the className string on or near that line, replace `oldUtility` with `newUtility` via a scoped regex (anchored to the className attribute, not the full file).
- Write the file. Vite HMR picks up.

## WS protocol

```ts
{ type: 'swap-utility',
  file: 'src/components/Hero.tsx',
  line: 42,
  col: 8,
  oldClass: 'mt-6',
  newClass: 'mt-4' }
```

Server responds:
- `{ type: 'swap-utility-ok' }` on success
- `{ type: 'swap-utility-error', message: '...' }` on failure (e.g., regex didn't match)

## Panel UX (gap variant)

```
↕ gap     [stepper: space.4 ◀ ▶]    2rem [editable]
            (swap source)        (redefine token)
```

- Stepper cycles through **all spacing tokens** (full scale), not just matching values.
- Picking a different token triggers `swap-utility` to swap the source class.
- The `2rem` field is an `<input>`. On blur/Enter, fires `emitTokenUpdate` with the new value. (Existing infra.)

## Non-goals (Phase 1)

- Padding/margin edits on regular elements (that's Phase 2).
- Color/typography (Phase 3).
- Variants like hover/focus modifiers (`hover:mt-8`).
- Arbitrary values (`mt-[24px]`) — only handle named-scale utilities.
- Dark mode variants.
- Multi-line className strings or `clsx`/`cn()` calls — Phase 1 supports simple inline string `className="..."` only.

## Edge cases

- **No matching utility on the element**: panel shows "no utility found" state, swap disabled.
- **Multiple matching utilities** (e.g., both `mt-6` and `pt-4`): pick the one matching the gap's exact CSS prop (margin-top, padding-top, etc.).
- **No `data-loc`**: agent falls back to read-only display; no swap action.

## Out of scope tensions, deferred

- What if the user wants a value not on the scale? → arbitrary values, deferred.
- What if the source uses a CSS variable directly (not a utility)? → not handled in Phase 1.
- What if the className is computed (e.g., `cn('mt-' + size)`)? → not handled.
