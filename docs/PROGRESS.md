# Progress log

Newest first. Each entry: what changed, what's next, gotchas. A fresh session must be
able to continue from the top entry alone.

## 2026-10-17 — Phase 1 started

Plan (each step = branch `feat/<scope>-<slug>`, merged `--no-ff`, pushed):
1. `docs/spec/threat-model.md`.
2. protocol: snowflake ids, error envelope + codes, pagination/common schemas.
3. server foundations: error handler, OpenAPI at `/api/v1/openapi.json`, Drizzle + migrations +
   Testcontainers harness, Valkey client + token-bucket rate limiter.
4. `docs/spec/auth.md` → auth: register modes, Argon2id, login, JWT + rotating refresh with
   reuse detection, sessions, email verify + reset (Mailpit), TOTP + recovery codes.
5. `docs/spec/gateway.md` → gateway: HELLO/IDENTIFY/READY/HEARTBEAT/RESUME, Valkey stream buffer,
   conformance tests.
6. desktop shell: CSP, typed IPC with Zod + sender checks, fuses, safeStorage, titlebar, tray,
   security checklist test.
7. ui: tokens, 3 themes, fonts, `<Glass>` tiers + governor, ambient layer, Storybook + snapshots.
8. i18n EN/FR, login/register screens, gateway status, `pnpm ui:shots`, design review.
Escalations expected: none for phase 1 (SMTP is Mailpit locally).

## 2026-10-17 — Phase 0 complete (pending tag)

- Done: monorepo + hooks, docs/ADRs 0001–0004, CLAUDE.md, `.claude/` agents/commands/hooks,
  package skeletons, Fastify server with validated env + `/health`, hardened Electron empty
  window with Playwright smoke test, dev compose stack (all healthy), GitHub Actions CI
  (green), README with generated glass art.
- Human requests folded in: GitHub remote with push after every step; README hero tagline
  trimmed; download site added to phase 7 (ADR-0004).
- Next: phase 1 — threat model, snowflake ids, error envelope, Drizzle + Testcontainers,
  auth spec, then auth and gateway.
- Gotcha: the guard hook ignores quoted text, so commit messages may mention forbidden flags.

## 2026-10-17 — Phase 0 in progress

- Done: brief saved, versions verified (ADR-0003), ADR-0001/0002, monorepo root,
  gitmoji commitlint rule + lefthook, PLAN, docs skeletons. Remote is GitHub
  (`FannyIsPrettyCool/SilverCord`); push after every step.
- Next: CLAUDE.md, `.claude/` setup, package skeletons, server boot, desktop window,
  dev compose stack, GitHub Actions CI, acceptance run, tag `v0.0.0`.
- Gotcha: default SSH agent identity is rejected by GitHub; the repo uses
  `core.sshCommand = ssh -i ~/.ssh/epitech_key -o IdentitiesOnly=yes` (local config,
  not committed). A fresh clone needs the same setting.
