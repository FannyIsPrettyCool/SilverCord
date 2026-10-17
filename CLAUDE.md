# SilverCord — agent index

Self-hosted Discord-class platform: Fastify server + Electron client, liquid-glass UI.
Full brief: `docs/BRIEF.md` (verbatim, never edit). Keep this file ≤200 lines.

## Session start (every session)
1. Read this file, top entry of `docs/PROGRESS.md`, current phase in `docs/PLAN.md`.
2. `git status`, `git log --oneline -20`, current branch.
3. `pnpm verify` — fix red before anything else.
4. Pick next unchecked task; read/write its `docs/spec/<feature>.md` first.

## Commands
| Command | What |
|---|---|
| `pnpm i` | install (also downloads Electron binary via `install-electron` postinstall) |
| `pnpm dev:stack` / `pnpm dev:stack:down` | Postgres, Valkey, LiveKit, Mailpit (loopback only) |
| `pnpm dev` | server (:4000, `node --watch`) + Electron |
| `pnpm verify` | Biome + typecheck + unit tests (affected) |
| `pnpm verify:all` | same, all packages (what CI runs) |
| `pnpm verify:full` | + integration + e2e |
| `pnpm lint:commits` | commitlint over `COMMITS_FROM..HEAD` |
| `pnpm --filter @silvercord/desktop test:e2e` | Playwright `_electron` (build first) |
| `python3 tools/readme-assets/generate.py <phase>` | regenerate README art at each phase boundary |

## Map
- `apps/server` — Fastify app (`src/app.ts` builds, `src/main.ts` listens), `src/config/env.ts` (Zod, refuses invalid boot). Modules go in `src/modules/<domain>/`.
- `apps/desktop` — `src/main` (windows, hardening), `src/preload` (CJS, typed bridge), `src/renderer` (React). `e2e/` Playwright.
- `packages/protocol` — Zod contracts, `brand.ts` (rename point). `packages/permissions|markdown|ui|widgets` — phase placeholders.
- `packages/config` — tsconfig presets. `tools/commitlint` — gitmoji rule. `infra/` — compose, LiveKit config.
- `docs/adr/` decisions · `docs/spec/` feature specs · `docs/PLATFORM-LIMITS.md` · `docs/DESIGN-CHECKLIST.md` · `docs/RUNBOOK.md`.

## Conventions
- Internal packages export TS source (`exports` → `src/*.ts`); no lib build step.
- Imports use explicit `.ts` extensions. Only erasable TS (no enums, parameter properties, namespaces).
- Strict TS incl. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` → use `obj['key']` for index signatures.
- No `any`, no `!` outside tests, no `@ts-ignore`. Files kebab-case; React components PascalCase.
- Pin exact versions; verify with `npm view` before adding. Never from memory.
- Every UI string via i18n (from phase 1). Obey BRIEF §7.8 anti-AI-look rules.
- Commits: `<gitmoji> <scope>: <imperative lowercase subject>` (≤72, no period). Scopes in `tools/commitlint/src/gitmoji.ts`. Atomic, ≤~300 lines, never mix refactor/deps with features.
- **Push after every commit** (`git push`). Remote: GitHub `FannyIsPrettyCool/SilverCord`, CI = GitHub Actions.
- Update `docs/PLAN.md` checkbox + `docs/PROGRESS.md` entry after each task.

## Gotchas
- GitHub SSH: default agent key is rejected; repo-local `git config core.sshCommand "ssh -i ~/.ssh/epitech_key -o IdentitiesOnly=yes"`.
- Electron 44 has no download postinstall; desktop's `postinstall: install-electron` handles it.
- electron-vite: workspace packages must be in `externalizeDeps.exclude` (main); preload uses `externalizeDeps: false` + CJS output (`index.cjs`) because the sandbox only polyfills `require`.
- Import `@silvercord/protocol/brand` (not the root) from Electron main to avoid bundling Zod.
- `getLastWebPreferences()` is untyped in Electron 44 types; cast in tests.
- pnpm 11 blocks dependency build scripts unless listed in `pnpm-workspace.yaml` `allowBuilds`; fresh releases need `minimumReleaseAgeExclude`.
- Fastify 5.12: `disableRequestLogging` top-level option is deprecated.
- Postgres 18 image: mount the volume at `/var/lib/postgresql` (not `/data`).
- LiveKit config keys: check `config-sample.yaml` at the pinned tag on GitHub; docs.livekit.io moved paths.
- Biome `useLiteralKeys` is off (conflicts with `noPropertyAccessFromIndexSignature`).

## Agents & commands (`.claude/`)
Agents: `architect`, `reviewer`, `security-auditor`, `design-critic`, `test-engineer`.
Commands: `/verify`, `/phase-start`, `/ship-phase`.
