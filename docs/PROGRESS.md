# Progress log

Newest first. Each entry: what changed, what's next, gotchas. A fresh session must be
able to continue from the top entry alone.

## 2026-10-18 — Phase 1 final review and VPS preparation

- Renderer gateway recovery fixed with eight new regressions: heartbeats wait for READY,
  temporary token failures retry, dead sockets detach immediately, and stale async results are ignored.
- Ambient cleanup now releases GPU resources without losing a reused canvas; unexpected context
  loss selects CSS fallback. Three lifecycle regressions and UI typecheck pass.
- Auto glass governor samples 90-frame bursts separated by five seconds without RAF, with
  visibility/focus cleanup and pause-gap regressions passing.
- Auth screens guard pending MFA, classify terminal token copy and expose age validation to
  screen readers; panel entrance is transform-only. Fourteen auth regression checks pass.
- Desktop main rejects authentication results started before logout and serializes token
  persistence. Six network/disk logout-race regressions pass.
- Gateway follow-up review fixed rejected/aborted-upgrade reservation leaks, authoritative
  handshake session checks, database-error handling and shutdown ordering; six transport tests pass.
- Gateway kick cleanup disposes subscriptions even when Valkey destruction fails, and consumes
  derived promise rejections. Two session-runtime regressions pass without unhandled errors.
- REST access tokens now check authoritative session state after a cache miss; lost revocation
  markers cannot restore access. Unit regressions and 68 real Postgres/Valkey integration tests pass.
- Positive notification permission test found Electron's trailing-slash origin serialization;
  exact app-origin variants are accepted and foreign/path origins remain denied. Real E2E passes.
- Removed pre-existing IPC lint warnings and pinned LF text checkout behavior for Windows;
  all-package lint/type/unit verification now passes without warnings.
- Owner requested centered auth panels. Centered layout now scrolls tall forms in short windows;
  10 Electron E2E tests and all three theme screenshot tours pass, including a real MFA step.
  Screenshot tour uses a dedicated private seed account and a fixed viewport. Turbo forwards API URLs.
- All confirmed follow-up review/security findings resolved. Verification: lint/type/unit clean
  (45 desktop, 33 server, 37 protocol, 26 UI, 17 commitlint), 68 integration, 10 Electron E2E,
  three theme screenshot tours and real WebGL-loss fallback. Latest CI and release merge/tag remain.
- Windows unpacked `v0.1.0` build verifies all seven security fuses; production dependency audit
  reports no known vulnerabilities. README roadmap art advances to phase 2.
- Original `D:\SilverCord` checkout has only line-ending changes and is preserved. Work continues
  in `D:\SilverCord-phase1` on `fix/phase1-review`; use native Windows Git before MSYS Git in PATH.
- VPS SSH works via the IslandMon key; Docker installed, private test stack running on loopback.
  User selected `silvercord.islandmon.cloud` and added its A record. SMTP is not configured.

## 2026-10-17 — Phase 1 review fixes in progress (branch `fix/phase1-review`)

- Reviewer (24 findings) and security audit (18 findings) ran at phase end. Fixed and pushed:
  all server/gateway items (handshake races, upgrade crash + limits, body-key hashing, IPv6 /64,
  NFKC, TOTP re-auth + mails + per-account cap, peppered recovery codes, dev secrets off-loopback,
  async forgot, IP-aware alerts, session revalidation, detached-runtime cap, route sweep tests),
  and desktop main (origin checks, refresh/logout races, forgot via IPC).
- Left (renderer + ui), from the review: gateway-client start heartbeat after READY, classify
  getToken errors (don't sign out on NETWORK/RATE_LIMITED), immediate zombie close, catch +
  socket capture on INVALID_SESSION re-identify; error-message map TOKEN_EXPIRED/REUSED/
  UNAUTHENTICATED; mfaPending guard on /sign-in/code; checkbox aria-invalid; AuthLayout
  transform-only entrance; AmbientLayer drop loseContext + handle context loss; governor burst
  sampling; positive permission e2e (notifications granted). Then merge fix branch → ui branch →
  main, tag v0.1.0, regenerate README art (`generate.py 2`).
- Gotcha: commit 280b5f2 doesn't typecheck alone (pushed); check each commit before pushing.

## 2026-10-17 — Phase 1: server + shell done, design system next

- Done: threat model; protocol (snowflakes, errors, pagination, auth, gateway frames); server
  error envelope + OpenAPI + CORS; Drizzle + Testcontainers; Valkey token-bucket limiter with
  mandatory per-route declarations (`config.rateLimit`, `config.auth`); full auth (register modes,
  invites, Argon2id, JWT + rotating refresh with reuse detection, sessions, email verify/reset via
  Mailpit, TOTP + recovery codes, new-device mail); gateway (HELLO/IDENTIFY/READY/HEARTBEAT/RESUME,
  session runtimes, ADR-0006); hardened Electron shell (app:// protocol, CSP headers, Zod IPC with
  sender checks, auth agent in main, safeStorage, tray, titlebar overlay, fuses verified).
- Tests: protocol 37, server unit 18 + integration 55, desktop unit 3 + e2e 7.
- Next: `packages/ui` (tokens, themes, fonts, Glass tiers + governor, ambient layer, Storybook),
  i18n, login/register screens + gateway status, `pnpm ui:shots`, design review; passkeys.
- Gotchas: verify each commit compiles on its own (two intermediate commits were red); Biome
  lints SVG/HTML too; Playwright `evaluate` bypasses page CSP.

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
