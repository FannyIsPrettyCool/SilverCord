# Progress log

Newest first. Each entry: what changed, what's next, gotchas. A fresh session must be
able to continue from the top entry alone.

## 2026-10-18 — Phase 3 foundation ready for guild features

- `feat/permissions-engine` contains the permission spec, bigint resolution/hierarchy engine,
  property tests and guild spec/ADR-0010.
  The engine and route guard are implemented; guild services, authoritative database
  permission reading and UI remain unfinished.
- Foundation security review fixed overwrite deletion/removal of denies restoring permissions,
  non-owner assignment of administrator roles and ineffective administrator timeouts. Sequence
  properties now apply actual accepted role positions and overwrite replacement/deletion.
  All 19 permission tests and typecheck pass.
- Guild/member/role/ban/audit database foundation is implemented with migration 0007.
  Composite member-role FKs reject foreign guilds/nonmembers; role positions are unique
  and deferrable for transactional swaps; position zero belongs only to `@everyone`.
  Six real PostgreSQL 18.6 tests pass, including ownership RESTRICT and cascading cleanup.
  Migration regeneration reports no drift. Guild services and routes are still pending.
- Required route declarations and the fail-closed guild/channel guard are implemented.
  Every existing route has an explicit non-guild reason; OpenAPI metadata is swept in CI.
  Future guild routes must wire a fresh authoritative `BuildOptions.permissionChecker`.
  Missing declarations fail registration; hidden resources are 404 and missing bits are 403.
- Verification: all-package checks pass, server unit tests pass 84 cases (two Linux-only
  groups skipped on Windows), and all 132 real PostgreSQL/Valkey integration tests pass.
  The production image builds with the permission workspace and imports app/engine as
  nonroot in a read-only, network-disabled container without credentials.
- Phase 2 is tagged `v0.2.0` at main 8df91a0; its CI is green. This branch includes the
  complete release. Working tree `D:\SilverCord-phase2-review` is on main for release operations.
- The public homepage/Windows download fix from main b48e662 is also merged here;
  it is live at https://silvercord.islandmon.cloud/ (details in the next entry).
- SMTP and encrypted off-host backup storage still need external provider credentials.

## 2026-10-18 — Public homepage and Windows download

- The owner found a raw API 404 at the production root on iPhone. Added `apps/site`:
  prerendered EN/FR HTML, shared Aurora tokens/icon/Figtree, centered responsive download
  panel, clear desktop/browser/mobile availability, no runtime scripts or third parties.
- Brought the minimal homepage and NSIS Windows x64 installer forward from Phase 7.
  The update feed, Linux packages, automatic platform selection and alternate themes remain
  Phase 7. Installer built from verified v0.2.0 output; no signing/update claim is made.
- Site build: `pnpm --filter @silvercord/site build`. Caddy serves the site and installer
  separately while preserving API/gateway/health and separate authenticated CDN behavior.
  See `docs/spec/download-site.md` and RUNBOOK for public static paths/deployment.
- Verified desktop/390px phone/320px narrow/French rendering, keyboard focus, no horizontal
  overflow, no external requests; all-package checks pass. Public EN/FR HTML and installer
  return 200; a full 125,439,672-byte HTTP download matches the local release SHA-256.
  API health is 200; API-host media remains 404 and unauthenticated CDN media remains 401.
- Static release is published at `/srv/silvercord-site/releases/502284795190ed09dbbcb375f6dc0d41d882da05`;
  `current` points there. Caddy config was validated and reloaded; the API was not restarted.
- Phase 3 foundations remain on `feat/permissions-engine` in `D:\SilverCord`; do not
  deploy the unfinished guild features. SMTP/off-host storage credentials remain external.

## 2026-10-18 — Phase 2 release `v0.2.0`

- Social messaging, private uploads and desktop chat are complete. Review/security fixes
  are merged into main; production audit deployment 582d5d2 is healthy. Release metadata
  advances server/desktop to 0.2.0 and README art to Phase 3; deploy the release SHA after CI.
- Real Electron 44.9.0 clients on Windows (Hypernova) and Linux (VPS/Xvfb) passed bidirectional
  delivery, markdown, typing, unread/read state, reaction, edit and decoded-image delivery.
  Stable visible transcript geometry passes on both machines. Reproduce with
  `tools/scripts/cross-machine-acceptance.sh`; evidence is under
  `.artifacts/cross-machine/sc-acceptance-20261018123057-3900/`.
- All-package checks pass (98 desktop unit tests), 124 Postgres/Valkey integrations pass,
  all Linux media safety regressions pass, ten Electron smoke/security tests pass, and the
  Windows unpacked package passes all seven fuse checks. 10k scroll: 1,939 frames,
  p95 13.9 ms, no frame over 33.4 ms on this workstation (docs/PERF.md).
- Both API and authenticated CDN use public HTTPS. No media bytes come from the API host.
  Consistent backup/restore drill recovered 10,131 staging messages and verified all three
  referenced media objects against database size and SHA-256. IslandMon services stay active.
- Next: `D:\SilverCord` / `feat/permissions-engine` has the audited 19-test engine and guild
  database foundation (six real DB tests). Route permission declarations/guard are being
  integrated; then guild services/channels/invites/roles and desktop UI. Bring the final
  release commit into that branch before continuing. Do not deploy unfinished Phase 3.
- Still external: SMTP provider and encrypted off-host storage credentials. Private Mailpit
  is not email delivery. Mid-laptop performance and a fresh-host restore remain later gates.

## 2026-10-18 — Phase 2 audit fixes and CDN release checks

- Worktree `D:\SilverCord-phase2-review`, branch `fix/phase2-review`, based on
  `origin/main` (33b825f). Original checkout's Phase 3 permission commits and unfinished
  guild schema are preserved on `feat/permissions-engine`.
- Latest main CI exposed quadratic parsing of unmatched opening brackets. Masked links
  now use a precomputed delimiter index; all 27 markdown tests pass, including escaped
  delimiters, invalid labels and the original adversarial performance regression.
- Audit fixes implemented and pushed: orphan chunk rollback cleanup, Linux decoder file isolation,
  per-attempt object keys, account-bound renderer requests/caches, history/read/typing
  reconciliation, atomic presence leases, consistent DB/media backups and separate CDN.
- Owner added `cdn.silvercord.islandmon.cloud`; HTTPS is live. CDN media requires bearer
  authentication (401 without it); API-host media and CDN non-media paths return 404.
- Private staging runs 3715671 with all six services healthy. Deployment successfully
  stopped/resumed API+worker for the consistent pre-migration database/media snapshot.
  Production rollout, latest CI and cross-machine acceptance remain before the tag.
- Verification so far: 124 real Postgres/Valkey integration tests, 27 isolated Linux media
  unit/integration cases, all-package checks (98 desktop unit tests) and ten Electron
  smoke/security tests pass. Backup lifecycle tests pass on Linux and run in CI.
- External dependencies remain SMTP and encrypted off-host storage credentials.

## 2026-10-18 — Phase 2 implemented and deployed (review pending, then `v0.2.0`)

- Server: relationships/blocks/privacy, transactional outbox (ADR-0008), DMs and groups with
  ordered locks, idempotent messages (replies, edits, deletes, reactions, mentions), read states
  with capped counts, presence leases + typing markers via gateway lifecycle hooks, media uploads
  (chunk ledger, quotas, sniffing, sandboxed decoder child + network-less decoder container,
  authorized delivery; ADR-0009). 121 integration tests, all routes swept for rate limits.
- `packages/markdown` (AST parser, property tests). Desktop: REST client + TanStack Query,
  gateway→cache sync, friends view, conversations, virtualized history (anchoring, jump-to),
  Tiptap composer (mentions, paste/drop uploads, drafts), cozy/compact/bubble, presence UI.
- Evidence: `e2e/live/two-clients.live.ts` (two Electron clients: typing, delivery, unread badge,
  reaction, edit, image through the decoder) against the VPS staging stack; 10k scroll p95 7.3 ms
  (docs/PERF.md); chat screenshots in `.artifacts/shots/app/`.
- Production runs api + worker + media-decoder at https://silvercord.islandmon.cloud; nightly
  backups include a media tarball; restore drill done into an isolated DB. Loopback staging stack
  documented in RUNBOOK (tunnel to localhost:4000).
- Blocked externally: `cdn.` DNS record (separate media origin), SMTP provider, off-host backup
  storage credentials, a second machine for the cross-machine acceptance run.
- Next: resolve reviewer/security findings, tag `v0.2.0`, deploy; then phase 3 (permissions spec,
  engine, guilds, invites, roles, member list, moderation, threads/pins).
- Gotchas: zustand selectors must not return new arrays (React #185); Vite data: assets vs CSP;
  staging one-offs need the staging image tag; no local Docker (use remote-integration.sh).

## 2026-10-18 — Phase 1 released (`v0.1.0`)

- Verified: review → UI → main merges are on `origin/main` (39608ce); its CI run is green;
  local `pnpm verify:all` green. Tagged `v0.1.0`. No earlier tag had been pushed.
- The main checkout had stale CRLF working files (Biome failed); re-checked them out as LF.
- Phase 2 specs, ADR-0008 and VPS ops drafts lived untracked in `D:\SilverCord-phase1`;
  an uncommitted relationships slice lived in `D:\SilverCord-social` (older base). Both are
  being folded into phase 2 branches from `main`.
- Next: phase 2 — commit specs, deploy the API to `silvercord.islandmon.cloud`, then
  relationships → channels/messages → markdown → presence/typing → read states → media → UI.

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
