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
| `pnpm db:migrate` / `pnpm db:seed` | migrate dev DB / open registration + accounts `aurora`, `tide` (pw `silvercord-dev-password`) |
| `pnpm --filter @silvercord/server test:integration` | Testcontainers (Postgres 18.6 + Valkey 9.1.2); needs Docker |
| `bash tools/scripts/remote-integration.sh [filters]` | same suite on the VPS Docker host (no local Docker), private network |
| `pnpm --filter @silvercord/desktop exec playwright test --config playwright.live.config.ts` | two-client + 10k scroll tests against a seeded server |
| `pnpm ui:shots` | real-app screenshot tour → `.artifacts/shots/app/` (needs dev stack + `pnpm dev` server + seed) |
| `pnpm --filter @silvercord/ui test:visual` | Storybook × theme × tier snapshots in Electron (local only; `:update` to rebaseline) |
| `pnpm --filter @silvercord/ui storybook` | Storybook on :6006 |
| `python3 tools/readme-assets/generate.py <phase>` | regenerate README art at each phase boundary |

## Map
- `apps/server` — Fastify app (`src/app.ts` builds, `src/main.ts` listens), `src/config/env.ts` (Zod, refuses invalid boot). Modules go in `src/modules/<domain>/`.
- `apps/desktop` — `src/main` (windows, hardening), `src/preload` (CJS, typed bridge), `src/renderer` (React). `e2e/` Playwright.
- `apps/server/src/modules/<domain>/` — schema, repository, service, routes per module; `src/gateway/` — event bus, session store/runtime, connection state machine; `src/http/` — error envelope, rate-limit + auth declarations (every route needs `config.auth` and `config.rateLimit`).
- `apps/desktop/src/main/auth/auth-agent.ts` holds refresh token + MFA ticket; renderer only gets access tokens via IPC.
- `apps/desktop/src/renderer/src/` — `app/` (router, App), `features/<area>/`, `session/`, `gateway/`, `i18n/locales/{en,fr}.json`.
- `packages/protocol` — Zod contracts (errors, pagination, auth, users, gateway), `brand.ts` (rename point).
- `apps/server/src/modules/{relationships,channels,messages,presence,media}` — phase 2; `src/events/outbox.ts` (ADR-0008), `src/services.ts` builds the domain graph for API and `src/worker-main.ts` (BullMQ media worker). Media decoder runs in a network-less container (ADR-0009).
- `apps/desktop/src/renderer/src/api/` — REST client (cached access token), TanStack Query keys, gateway→cache `sync.ts`, uploads/media blobs; `features/{chat,social,presence}`.
- `packages/markdown` — chat-markdown → AST (no HTML).
- `packages/ui` — themes/tokens, `<Glass>` + tiers + governor + refraction, `AmbientLayer`, primitives, Storybook, `visual/` snapshots. `packages/permissions|widgets` — placeholders.
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
- Windows: prefer native Git (`C:\Program Files\Git\cmd`) over MSYS Git for worktrees and hooks.
  Text files use LF (`.gitattributes`); the original checkout's line-ending changes may be left intact.
- GitHub SSH: default agent key is rejected; repo-local `git config core.sshCommand "ssh -i ~/.ssh/epitech_key -o IdentitiesOnly=yes"`.
- Electron 44 has no download postinstall; desktop's `postinstall: install-electron` handles it.
- electron-vite: workspace packages must be in `externalizeDeps.exclude` (main); preload uses `externalizeDeps: false` + CJS output (`index.cjs`) because the sandbox only polyfills `require`.
- Import `@silvercord/protocol/brand` (not the root) from Electron main to avoid bundling Zod.
- `getLastWebPreferences()` is untyped in Electron 44 types; cast in tests.
- pnpm 11 blocks dependency build scripts unless listed in `pnpm-workspace.yaml` `allowBuilds`; fresh releases need `minimumReleaseAgeExclude`.
- Fastify 5.12: `disableRequestLogging` top-level option is deprecated.
- Postgres 18 image: mount the volume at `/var/lib/postgresql` (not `/data`).
- LiveKit config keys: check `config-sample.yaml` at the pinned tag on GitHub; docs.livekit.io moved paths.
- The workstation's global gitignore excludes `**/.claude/`; repo `.gitignore` re-includes it. Always check `git status` shows new `.claude/` files before committing; verify on a fresh clone at phase end.
- `.claude/hooks/guard-bash.ts` is live in this session: it strips quoted text before matching, so messages may mention forbidden flags.
- Biome reformats files on write (hook): scripted `str.replace` on code often misses; prefer the Edit tool on freshly read text.
- Gitmoji allowlist is strict (e.g. 📸 is rejected); see `tools/commitlint/src/gitmoji.ts`.
- Chromium (Electron 44): `backdrop-filter: url(#svg) blur()` ignores everything after `url()`, and a reference filter with a primitive after `feDisplacementMap` isn't applied → refraction filter does blur/saturate/brightness itself, displacement last.
- WebAuthn is unavailable on `app://` (ADR-0007). Playwright `evaluate` bypasses page CSP.
- Vite React refresh needs inline scripts → dev-only `'unsafe-inline'` in script-src.
- `#root` needs `height: 100%` (renderer `app/app.css`) or layouts collapse.
- CI uses `concurrency: cancel-in-progress`: a newer push cancels the older run; check the latest SHA. Check runs with `tools/scripts/ci-status.sh <sha>` (annotations are public; logs need admin).
- Biome `useLiteralKeys` is off (conflicts with `noPropertyAccessFromIndexSignature`).
- Zustand selectors returning a new array/object loop under React 19 (error #185): wrap them in `useShallow`.
- Vite inlines small assets as data: URLs, which the CSP blocks: renderer `assetsInlineLimit: 0`.
- Tiptap classes (`is-editor-empty`) are global: use `:global(...)` inside CSS modules.
- Staging: `COMPOSE_PROJECT_NAME=silvercord-staging` env file; run one-offs with `SILVERCORD_IMAGE=silvercord-api:silvercord-staging-current` or they use prod's image. Tunnel `ssh -L 4000:127.0.0.1:14100` for local UI work (docs/RUNBOOK.md).
- Node 24 permission model has no network flag; decoder isolation is the container (`network_mode: none`).
- ioredis 6 `zrange` takes string bounds ('0', '-1').

## Agents & commands (`.claude/`)
Agents: `architect`, `reviewer`, `security-auditor`, `design-critic`, `test-engineer`.
Commands: `/verify`, `/phase-start`, `/ship-phase`.
