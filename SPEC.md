# designmd-live — SPEC

> Live editor pour DESIGN.md, wired sur ton vrai codebase. Tweake les tokens, vois tes vrais composants re-render. Switch entre plusieurs DESIGN.md pour comparer.

Date : 2026-05-08
Statut : MVP scaffold

---

## 1. Pitch

Un outil dev qui s'installe dans n'importe quel projet Next.js + Tailwind v4. Il lit le `DESIGN.md` à la racine, ouvre un panneau web sur un port local, et permet d'éditer les tokens **avec hot-reload visuel sur l'app réelle de l'utilisateur** — pas un canvas démo.

Bonus killer : tu peux charger plusieurs DESIGN.md (locaux ou depuis une lib) et **switcher en live** pour voir comment ton appli réagit à chaque skin.

## 2. Concurrence (mai 2026)

| Tool | Ce qu'il fait | Limite |
|---|---|---|
| **designmd.ai** | Annuaire de 100+ DESIGN.md à télécharger | Pas d'éditeur, pas de live preview |
| **designmd.app** | Library de 454 templates | Idem, statique |
| **getdesign.md** | Collection curated | Idem |
| **design.dev** | Playground générique avec canvas démo | Canvas isolé, pas wired sur ton repo |
| **shuffle.dev** | Design dans Shuffle → export DESIGN.md | Unidirectionnel, pas live |

**Angle libre** : éditeur live wired sur le vrai codebase + multi-skin switching.

## 3. Architecture

### Monorepo Turborepo

```
designmd-live/
├── apps/
│   ├── landing/          # Next.js 16 — site marketing (deployed Vercel)
│   └── panel/            # Vite + React 19 — le panneau dev embarqué
├── packages/
│   ├── cli/              # npm package distribué (`npx designmd-live`)
│   ├── core/             # parser DESIGN.md, types, validation Zod
│   └── ui/               # shadcn primitives partagés
├── pnpm-workspace.yaml
├── turbo.json
└── biome.json
```

### Flow utilisateur cible

1. `pnpm add -D designmd-live` dans son projet Next.js + Tailwind v4
2. `npx designmd-live dev` → ouvre `http://localhost:3001`
3. Le panneau lit le `DESIGN.md` à la racine, affiche les tokens dans un sidebar
4. Édition d'un token → injection live des CSS vars dans `:root` du dev server cible (via WebSocket)
5. L'appli de l'utilisateur re-render instantanément (pas de reload)
6. Bouton "Apply" → écrit le DESIGN.md modifié sur disque
7. Bouton "Switch skin" → loade un autre DESIGN.md (local ou depuis une lib distante) et applique en live

## 4. Stack & justifications

| Choix | Pourquoi |
|---|---|
| **Turborepo** | Standard mai 2026 (next-forge, T3). Cache build. Vercel-native. |
| **pnpm workspaces** | Le seul sain pour monorepo. |
| **Vite + React 19** (panel) | Standard dev tools (Storybook, Vue Devtools). HMR <100ms. Next.js overkill pour panel embarqué. |
| **Next.js 16 App Router** (landing) | Best DX marketing, Vercel-native. |
| **Tailwind v4** | CSS vars natives dans `@theme {}` = required pour live-swap sans rebuild. |
| **shadcn/ui** | Tu possèdes les composants, zéro vendor lock. |
| **tsup + citty** (CLI) | citty = UnJS/Nuxt, API moderne. tsup = build TS rapide. |
| **Hono** (local server) | Minimal, runtime-agnostic, ultra rapide. |
| **WebSocket (`ws`)** | Canal panneau ↔ projet cible pour push tokens en live. |
| **Zod** | Validation runtime DESIGN.md parsé. |
| **Biome** | Lint + format en un seul outil Rust, 10x plus rapide qu'ESLint+Prettier. |
| **Vitest** | Standard pour Vite. |
| **Node 24 LTS** | Default Vercel, support TS natif. |

## 5. Pré-requis du projet cible

- Tailwind v4 (CSS vars dans `@theme`)
- DESIGN.md à la racine, suivant la spec Google (YAML front matter + prose)
- Convention : tokens DESIGN.md mappés 1:1 aux CSS vars

## 6. MVP — découpage

### v0.1 (jour 1-2) — parsing + panel statique
- `packages/core` : parser DESIGN.md (YAML front matter + Zod schema)
- `apps/panel` : Vite + React 19 + Tailwind v4 + shadcn
- Affichage des tokens lus depuis un fichier mocké

### v0.2 (jour 3-4) — édition live ✅
- `packages/cli` : `npx designmd-live dev`
- Hono server local sur :3030 (port choisi pour cohabiter avec Next.js dev)
- WebSocket sur même port (`/ws`) pour push tokens vers projet cible
- Agent script servi sur `/client.js`, à injecter dans le `<head>` du projet cible en dev
- Panel : iframe du projet cible + token edits broadcast en live

### v0.3 — friction zéro ✅
- Mode proxy : `--proxy http://localhost:3000` reverse-proxie le dev server et injecte le script automatiquement dans le HTML. Aucune modif de code requise dans le projet cible.
- Panel servi sous `/__designmd-live/` quand la racine est utilisée par le proxy.
- `designmd-live init` scaffolde un DESIGN.md de départ.
- Bundle CLI single-port : `npx designmd-live dev` lance tout (panel + API + WS + proxy optionnel) sur un seul port.

### v0.4 — multi-skin switching
- Dropdown de DESIGN.md (locaux + URL distantes)
- Switch instantané, swap complet des CSS vars

### v0.5 — landing + démo vidéo
- `apps/landing` : Next.js 16, hero + démo gif + npm install snippet
- Deploy Vercel

### v1.0 (semaine 2) — polish + distribution
- Hardcode token detector (flag les couleurs hardcodées dans les composants qui ne réagiront pas au swap)
- Apply → écriture DESIGN.md disque
- Lint via `@google/design.md`
- Product Hunt + post Twitter

## 7. Risques & inconnus

- **Tailwind v3** non supporté en v1 (rebuild requis). Décision : on assume v4.
- **Typo (font-family)** — injection live nécessite preload ou `@font-face` dynamique. Punt sur v0.2, ship en v0.3.
- **Composants avec couleurs hardcodées** ne réagiront pas. Plan : detector qui flag les hardcodes (= différenciation forte).
- **Sécurité** : le dev server local ne doit accepter que localhost (pas de bind 0.0.0.0).

## 8. Naming & branding

- **Nom** : `designmd-live`
- **Domain cible** : `designmd.live` (à check disponibilité) ou `live.designmd.app`
- **Tagline** : "Tweak your DESIGN.md, see your real app react. Live."

## 9. Distribution

- npm package `designmd-live` (CLI)
- Site `designmd.live` (landing + démo vidéo)
- Soumis à designmd.ai en companion tool
- Post Product Hunt
- Post X/Bluesky avec démo vidéo (15s skin switching)

## 10. Au-delà du MVP (idées)

- VS Code extension (panneau directement dans l'éditeur)
- Figma plugin (sync DESIGN.md ↔ Figma variables)
- Cloud version (collaborative editing)
- Marketplace de DESIGN.md premium
- Auto-detect : scan le repo et propose un DESIGN.md initial
