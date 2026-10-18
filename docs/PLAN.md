# SilverCord plan

Living roadmap. Source of truth for scope is `docs/BRIEF.md` §13. Check a box only
when the task meets the definition of done (BRIEF §11.5). Each phase ends with a
`v0.<phase>.0` tag.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` blocked (see PROGRESS.md)

---

## Phase 0 — Foundations

Accept: fresh clone → `pnpm i && pnpm dev` boots server + empty Electron window;
`pnpm verify` green in CI.

- [x] Save brief verbatim to `docs/BRIEF.md`
- [x] Verify toolchain versions; ADR-0003
- [x] ADR-0001 assumptions, ADR-0002 Electron vs Tauri
- [x] git init; lefthook + commitlint gitmoji rule enforced from first commit
- [x] `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/PLATFORM-LIMITS.md`, `docs/DESIGN-CHECKLIST.md`, `docs/RUNBOOK.md`
- [x] `CLAUDE.md` index
- [x] `.claude/` agents (architect, reviewer, security-auditor, design-critic, test-engineer), commands (`/verify`, `/phase-start`, `/ship-phase`), settings hooks
- [x] Package skeletons: protocol (incl. `brand.ts`), permissions, markdown, ui, widgets, config
- [x] `apps/server`: Fastify boot, validated `env.ts`, `/health`, pino logging, graceful shutdown
- [x] `apps/desktop`: electron-vite app opening an empty hardened window
- [x] `infra/docker-compose.dev.yml`: Postgres, Valkey, LiveKit (dev), Mailpit, local storage dir
- [x] Root scripts: `dev`, `verify`, `verify:full`, `ui:shots`, `db:migrate`, `db:seed`, `release`
- [x] `.github/workflows/ci.yml` (thin): lint, typecheck, unit tests, commit-message check
- [x] Acceptance run: fresh clone → install → dev boots server + window; verify green
- [x] Tag `v0.0.0`
- [x] CI run on GitHub Actions confirmed green

## Phase 1 — Core platform + design system v1

Accept: sign up, log in, see live gateway connection; glass renders in all tiers;
security checklist test passes; threat model written.

- [x] `docs/spec/threat-model.md`
- [x] Snowflake id generator (+ property tests) in `packages/protocol`
- [x] Error envelope + machine codes in `packages/protocol`
- [x] REST schema conventions, OpenAPI generation at `/api/v1/openapi.json`
- [x] DB: Drizzle setup, migrations pipeline, `db:migrate`, Testcontainers harness
- [x] Valkey client, token-bucket rate limiter (+ tests)
- [x] Spec `docs/spec/auth.md`
- [x] Auth: register (invite-only/open/closed; first user = admin), Argon2id, login
- [x] Auth: access JWT + rotating refresh with reuse detection; sessions list/revoke
- [x] Auth: email verification + password reset (Mailpit in dev)
- [x] Auth: TOTP + recovery codes
- [~] Auth: passkeys — moved to phase 7 (ADR-0007: WebAuthn is unavailable on the app:// origin)
- [x] Auth: instance invites (admin) + new-device login email
- [x] Spec `docs/spec/gateway.md`; gateway opcodes in protocol
- [x] Gateway: HELLO/IDENTIFY/READY/HEARTBEAT/RESUME with Valkey stream buffer; conformance tests
- [x] Electron shell: hardened prefs, CSP, typed preload bridge, IPC validation, fuses, safeStorage token store
- [x] Electron security checklist test (§8.2)
- [x] Electron: custom titlebar (Win11 `backgroundMaterial`, Linux frameless), tray, single-instance
- [x] UI: tokens, 3 themes (Aurora, Frost, Midnight Ember), fonts bundled (Figtree, JetBrains Mono)
- [x] UI: `<Glass>` + `useGlass` with tiers High/Low/Solid/Auto + frame governor
- [x] UI: ambient layer (`ogl`) + CSS fallback
- [x] UI: Storybook + visual snapshots per tier/theme
- [x] `pnpm ui:shots` (Playwright `_electron`)
- [x] i18n setup (EN + FR, ICU)
- [x] Login/register screens + live gateway status
- [x] `docs/DESIGN-CHECKLIST.md` review of phase screens
- [x] Renderer gateway review: ready-only heartbeats, retryable token errors, immediate reconnect,
      stale socket result protection and handled re-identification failures
- [x] Ambient lifecycle review: React remount cleanup and WebGL context-loss fallback
- [x] Auto glass governor review: burst sampling with no idle RAF loop
- [x] Auth screen review: MFA guard, token error copy, age accessibility and panel motion
- [x] Logout races: generation-bound login/register/MFA/restore and serialized token persistence
- [x] Gateway follow-up review: malformed/aborted upgrades, validation outages and active shutdown
- [x] Gateway kick cleanup: dispose after Valkey errors without unhandled rejection
- [x] Durable revocation: authoritative session checks when cache markers are missing
- [x] Positive Electron notifications permission regression, including serialized app origin
- [x] Centered auth panels (owner request), short-window scrolling and real MFA screenshot flow
- [x] Phase-end reviewer and security auditor: all confirmed high/medium findings resolved
- [x] Release gate: latest CI, merge review → UI → main, tag `v0.1.0`

## Phase 2 — Social & messaging

Accept: two real clients on different machines chat in DMs through the VPS; scroll
stays 60 fps on 10k-message seed.

- [x] Specs: relationships, messaging, media, presence (+ operations, chat-screens; ADR-0008, ADR-0009)
- [x] Relationships: friend requests, accept/decline/cancel, remove, block, notes/nicknames, privacy
- [x] Channels: DM, group DM (max 10 default)
- [x] Messages: create (idempotency key), edit, delete, replies, reactions (unicode), pagination
- [x] `packages/markdown`: chat-markdown → AST parser (+ property tests)
- [x] Typing indicators, presence (friends; shared-guild audiences arrive with phase 3)
- [x] Read states + unread/mention badges
- [x] Media: upload pipeline, content sniffing, sharp (EXIF strip, thumbs, blurhash), quotas;
      separate authenticated CDN at https://cdn.silvercord.islandmon.cloud (API host rejects media)
- [x] Composer (Tiptap): markdown, mentions autocomplete, paste/drop uploads, drafts
- [x] Message list: virtualized, scroll anchoring, jump-to; 10k seed at 60 fps (docs/PERF.md)
- [x] Density: cozy, compact, bubble (DMs)
- [x] Prod compose, Caddy + TLS, deploy script, backup job (off-host copy needs storage credentials)
- [x] Deploy to OVH VPS: https://silvercord.islandmon.cloud
- [x] Acceptance: real Windows and Linux Electron clients on separate machines chat through the
      private VPS staging stack; messages, typing, read states, edits, reactions and decoded media
      pass in `e2e/live/cross-machine.live.ts`; settled screenshots pass on both machines
- [x] Phase-end reviewer and security audit: chunk rollback, decoder isolation, worker retries,
      account switching, history/read/typing/presence races and DB/media snapshot consistency
- [x] Release gate: cross-machine acceptance, full verification, CI, merge and tag `v0.2.0`

## Phase 3 — Servers & permissions

Accept: permission matrix test suite green; route-without-permission-declaration CI
check in place; invite flow works end to end.

- [ ] `docs/spec/permissions.md`
- [ ] `packages/permissions` engine + fast-check properties (monotonicity, precedence, admin bypass, hierarchy, no escalation)
- [ ] Route permission declaration + CI check
- [ ] Guilds, categories, channels (text/voice/announcement), drag reorder
- [ ] Invites (expiry, max uses, temporary), `silvercord://` deep link
- [ ] Roles UI (color, icon, hoist, mentionable), overwrites UI
- [ ] Member list (lazy range subscriptions)
- [ ] Moderation: kick, ban (+purge), timeout; audit log
- [ ] Threads, pins

## Phase 4 — Voice, video, calls

Accept: 4-person call across different networks stable; server mute/move works;
documented capacity numbers for the VPS.

- [ ] `docs/spec/voice.md` incl. bandwidth math
- [ ] LiveKit on VPS (single UDP port, TCP fallback, embedded TURN)
- [ ] Token service with permission-derived grants
- [ ] Voice state + webhook reconciliation
- [ ] Voice channels, DM/group calls with ringing
- [ ] Devices, VAD/PTT (global hook Win/X11; Wayland fallback), per-user volume
- [ ] Camera, screen share (Win loopback audio; Wayland portal), grid/spotlight
- [ ] Voice dock, pop-out window, reconnect, quality indicator
- [ ] Two-participant fake-media automated test

## Phase 5 — Profiles & expression

Accept: profile popout and full view polished, privacy toggles honored server-side.

- [ ] Profile fields (banner, avatar, pronouns, status, custom status, bio, accent)
- [ ] Badges (definitions, awards, rules, pinning)
- [ ] Activity: manual, game detection, local RPC (`docs/rpc.md`), media session
- [ ] Custom emotes/stickers, emoji picker (licensed set), GIF picker (verified provider)
- [ ] Per-server profiles

## Phase 6 — Widgets & theming

Accept: a user can build, share and hide-per-audience a widget profile;
invalid/malicious widget JSON is rejected by tests.

- [ ] Widget schema v1 + server validation + fuzz tests
- [ ] Renderers for the Tier A catalog
- [ ] Editor (12-col grid, drag/resize, live preview, import/export)
- [ ] Two integration providers (SSRF-safe fetcher)
- [ ] Theme engine, editor with contrast guard, presets, import/export, wallpaper

## Phase 7 — Polish & completeness

Accept: clean install on Windows 11 and a Wayland Linux session; update from vN to
vN+1 works.

- [ ] Search (FTS FR/EN + trigram, permission-filtered)
- [ ] Notification settings, tray badges, deep links
- [ ] Full settings surface
- [ ] i18n complete EN + FR
- [ ] Accessibility pass
- [ ] Tree layout
- [ ] Auto-update, NSIS installer, AppImage/deb/rpm
- [x] Early public homepage: centered EN/FR desktop download page and Windows x64 installer
      (owner's mobile-root 404 report; update feed and other platforms remain below)
- [ ] Passkeys via system browser + `silvercord://` deep link (ADR-0007)
- [ ] Download site (`apps/site`): one static page served at `<DOMAIN>` (and `get.<DOMAIN>`)
      that detects the visitor's OS and offers the matching installer (NSIS / AppImage / deb / rpm)
      read from the `stable` update feed (`latest.yml`, `latest-linux.yml`) on `updates.<DOMAIN>`;
      version + release date shown; other platforms listed below. Built with `packages/ui` tokens,
      themes and ambient layer so it matches the app (glass, Aurora/Frost by `prefers-color-scheme`).
      No tracking, no third-party requests, fonts bundled; BRIEF §7.8 copy rules apply; EN + FR.
      Served by Caddy from the prod compose stack. Spec: `docs/spec/download-site.md`. ADR-0004.
- [ ] Performance pass vs budgets → `docs/PERF.md`

## Phase 8 — Hardening & operations

Accept: restore drill executed from scratch; 2k-socket load test within budget; no
high/critical findings open.

- [ ] Security audit pass
- [ ] Gateway load test (k6, 2k sockets)
- [ ] Restore drill
- [ ] Monitoring dashboards (Prometheus + Grafana profile)
- [ ] Rate-limit tuning
- [ ] GDPR export/delete verified
- [ ] Instance admin panel

## Phase 9 — Stretch

- [ ] Bots/webhooks/public API
- [ ] Soundboard, stage, forum channels
- [ ] Tier B widgets
- [ ] E2EE (MLS) DMs + calls
- [ ] Flatpak, macOS build

---

## Backlog / follow-ups

- [ ] Code block syntax highlighting (messaging spec lists it; plain monospace for now)
- [ ] Full emoji picker for reactions (quick set of six until phase 5)
- [ ] Off-host encrypted backups (restic) once storage credentials exist
- [ ] Real SMTP provider for production (staging profile routes mail to private Mailpit)
- [ ] Repeat the scroll measurement on an integrated-GPU laptop (docs/PERF.md)

- [ ] Polish: tune High-tier refraction (bezel width, displacement scale, corner artifacts) on real UI pills

- [ ] Upgrade pnpm 11 → 12 after reviewing its changelog (ADR-0003)
- [ ] Reassess Node 26 LTS once it enters Active LTS (late October 2026)
