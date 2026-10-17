# ADR-0003: Monorepo layout, tooling and verified versions

- Status: accepted
- Date: 2026-10-17

## Context

The brief fixes the stack (§3). This ADR records the exact versions verified at
project init and the tooling choices the brief leaves open.

## Verified versions (2026-10-17)

Checked with `npm view <pkg> version`, nodejs.org/dist/index.json and the Docker Hub
tags API. Never bump these from memory.

| Tool | Version | Source |
|---|---|---|
| Node.js | 24.x "Krypton" (Active LTS, latest 24.22.0) | nodejs.org; `.nvmrc` = 24, `engines` ≥ 24.11. Node 26 enters LTS later in October 2026; local workstation runs 26.9 which is compatible. |
| pnpm | 11.26.0 (pinned via `packageManager`) | registry `latest` is 12.14.0; 11.26.0 is the installed toolchain. Upgrade to 12 is a planned chore once its changes are reviewed. |
| TypeScript | 7.0.2 (native compiler) | registry |
| Turborepo | 2.11.9 | registry |
| Biome | 2.5.15 | registry |
| Vitest | 5.0.5 | registry |
| lefthook | 2.2.2 | registry |
| commitlint | 21.2.3 | registry |
| Electron | 44.9.0 | registry (`latest`) |
| electron-vite | 6.0.0 | registry |
| electron-builder | 26.15.3 | registry |
| electron-updater | 6.8.9 | registry |
| @electron/fuses | 2.1.3 | registry |
| Vite | 8.3.4 | registry |
| React | 19.3.1 | registry |
| Fastify | 5.12.7 | registry |
| Zod | 4.6.7 | registry |
| fastify-type-provider-zod | 7.0.0 | registry |
| Drizzle ORM / drizzle-kit | 0.45.4 / 0.31.11 | registry |
| ws | 8.22.0 | registry |
| pino | 10.4.0 | registry |
| livekit-client / livekit-server-sdk | 2.23.0 / 2.19.1 | registry |
| PostgreSQL image | `postgres:18.6` | Docker Hub (19 is RC only) |
| Valkey image | `valkey/valkey:9.1.2` | Docker Hub (9.2 is RC only) |
| LiveKit server image | `livekit/livekit-server:v1.13.10` | Docker Hub |
| Caddy image | `caddy:2.11.7` | Docker Hub |
| Mailpit image | `axllent/mailpit:v1.31.6` | Docker Hub |
| Garage image | `dxflrs/garage:v2.4.1` | Docker Hub |

## Decisions

- **Workspace:** pnpm workspaces (`apps/*`, `packages/*`, `tools/*`) + Turborepo
  for task orchestration and caching. `tools/` holds repo tooling such as the
  commitlint gitmoji rule.
- **Internal packages are consumed as TypeScript source** (`exports` point at
  `src/index.ts`). No per-package build step for libraries; Vite (desktop) and
  Node's built-in type stripping (server) consume `.ts` directly. Consequences:
  imports use explicit `.ts` extensions (`allowImportingTsExtensions`), and only
  erasable TypeScript syntax is allowed (`erasableSyntaxOnly`: no enums, no
  parameter properties, no namespaces).
- **Strictness:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`. Biome's
  `useLiteralKeys` is disabled because it conflicts with
  `noPropertyAccessFromIndexSignature`.
- **Lint/format:** Biome only (no ESLint/Prettier). Typecheck with `tsc --noEmit`
  per package via Turbo.
- **Commit policy:** lefthook runs Biome on staged files (pre-commit) and
  commitlint with the custom `silvercord-header` rule (commit-msg). The same rule
  runs in CI against the pushed range.
- **Exact pins:** `.npmrc` sets `save-exact=true` and `engine-strict=true`.
- **pnpm build scripts** are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).

## Consequences

- TypeScript 7 is the Go-native compiler. Tools that embed the TypeScript JS API
  may lag behind; if one breaks, pin that tool's own TypeScript dependency rather
  than downgrading the workspace, and record it in CLAUDE.md gotchas.
- No library build step keeps iteration fast, but production server images must
  either run Node with type stripping or bundle; decided in the deploy ADR.
