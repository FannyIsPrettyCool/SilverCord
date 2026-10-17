# {{APP_NAME}} — Agent Brief

Target agent: Claude Opus 5.5 running in a harness with shell, file, git, web fetch, Playwright/browser and subagent tools (Claude Code or equivalent).
Brief version: 1.0 — written 2026-10-17.

---

## 0. Fill-ins (human completes before pasting; defaults apply if left blank)

| Key | Value | Default if blank |
|---|---|---|
| APP_NAME | | Pick a short working name, derive a slug, keep it trivially renamable (single `brand.ts` + package scope) |
| DOMAIN | | `localhost` / `*.localhost` until a real domain is provided |
| VPS | OVH plan, vCPU / RAM / bandwidth / OS | Assume 4 vCPU, 8 GB RAM, 1 Gbps, Ubuntu LTS |
| GIT_HOST | | GitLab (CI in `.gitlab-ci.yml`, all logic in `pnpm` scripts so the CI file stays thin) |
| REGISTRATION | open / invite-only / closed | invite-only |
| LANGUAGES | | English + French from day one |
| LICENSE | | Proprietary, all rights reserved |
| TARGET_SCALE | concurrent users | Private community, up to ~500 concurrent; scale vertically first |

Never block on a blank fill-in. Apply the default, record it in `docs/adr/0001-assumptions.md`, move on.

---

## 1. Mission

Build {{APP_NAME}}: a self-hosted, Discord-class real-time communication platform.

It has accounts, friends, DMs, group chats, servers with roles and channel-level permissions, text channels, voice channels, video and screen sharing, group and DM calls, file/image/GIF/emote sharing, and rich profiles (badges, banner, avatar, pronouns, status, bio, activity, custom profile widgets).

Deliverables:
1. A server that runs on one OVH VPS via Docker Compose, deployable and recoverable by a single operator.
2. A **Windows-first Electron desktop client** with installer and auto-update; Linux client (X11 and **Wayland**) as a supported second target (AppImage + deb + rpm).
3. A UI in a **liquid-glass** visual language (section 7), nothing like a default-AI-generated interface.
4. Documentation sufficient for a new contributor (human or agent) to resume work cold.

Non-goals for v1: mobile apps, public web client (keep renderer code web-portable, but don't ship it), federation, payments/monetization. E2EE and bots are phase 9 stretch.

---

## 2. Operating principles

<principles>
1. **Autonomy by default.** Work through the roadmap (section 13) phase by phase without asking permission. Ask the human only at the escalation triggers in section 11.6.
2. **Verify, don't assume.** Never state or pin a package version from memory: check the registry (`npm view <pkg> version`). Never configure LiveKit, Electron, Caddy, Postgres or OS tooling from memory: read the current official docs first (web fetch). Library APIs change; docs win over recall.
3. **Evidence over claims.** A task is done when it is demonstrated: tests green, the thing actually run, and for UI a screenshot reviewed (section 11.4). "Should work" is not done.
4. **State lives in files, not in context.** Context is finite and sessions end. Decisions go to ADRs, progress to `docs/PROGRESS.md`, tasks to `docs/PLAN.md`, conventions to `CLAUDE.md`.
5. **Smallest coherent step, committed often** (section 12).
6. **Be honest about platform limits.** If a platform cannot do something (Wayland blur, global push-to-talk on Wayland, SmartScreen without signing), implement the best fallback, state the limitation in `docs/PLATFORM-LIMITS.md`, and never fake it.
7. **Security and correctness are not phases.** Permission checks, input validation, rate limits and auth rules ship with each feature, not afterwards.
8. **Match scope to roadmap order.** Don't build phase 6 things while phase 3 is unfinished. Don't gold-plate outside the brief; do go deep inside it.
9. **Prefer boring, proven infrastructure** (Postgres, Valkey, Caddy, LiveKit) over clever custom infrastructure. Be custom only where the product is the point: gateway protocol, permissions, UI.
10. **Think hard at decision points.** Before architecture choices, schema design, protocol design and the permission engine, reason through alternatives and failure modes, then write the ADR. Routine code does not need ceremony.
</principles>

---

## 3. Tech stack (decided; deviating requires an ADR with justification)

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) everywhere | One contract language across server, client, shared packages |
| Contracts | **Zod schemas as the single source of truth** in `packages/protocol` → TS types, runtime validation, OpenAPI (via `zod-to-openapi`) | Client and server can't drift |
| Monorepo | pnpm workspaces + Turborepo | Fast, cache-friendly |
| Server runtime | Node.js (current Active LTS; verify at nodejs.org) | Shared types with client, fast agent iteration |
| HTTP | Fastify 5 + Zod type provider | Schema-first, fast |
| Gateway | Own WebSocket protocol on `ws`, Discord-style (section 5.3) | Product-critical, must be fully controlled |
| Database | PostgreSQL (latest stable major) + Drizzle ORM + drizzle-kit (SQL migrations, reviewed) | Reliable, FTS via `tsvector` + `pg_trgm` |
| Cache / pub-sub / presence / rate limits | Valkey (ioredis-compatible client) | Ephemeral state and fan-out |
| Jobs | BullMQ on Valkey | Image processing, link unfurl, cleanup, email |
| Object storage | S3-API abstraction. Dev: local FS driver. Prod: Garage (self-hosted) or OVH Object Storage | Swappable, no vendor lock |
| Media processing | `sharp`, `ffmpeg` | Thumbnails, EXIF strip, animated formats |
| Voice/video | **LiveKit** server (self-hosted SFU, Apache-2.0) + `livekit-client` + `livekit-server-sdk` | Production-grade WebRTC SFU incl. simulcast, TURN, webhooks. Don't write an SFU |
| Reverse proxy / TLS | Caddy 2 | Automatic TLS, HTTP/3, tiny config |
| Desktop shell | **Electron** (newest stable at project init; run `npm view electron version`; 43+ as of this writing, 45 scheduled 2026-10-20), `electron-vite`, `electron-builder`, `electron-updater`, `@electron/fuses` | Bundled Chromium = consistent WebRTC and `backdrop-filter` on every OS |
| Renderer | React 19, TanStack Router + Query + Virtual, Zustand + immer, Radix primitives (headless, accessibility only), Tiptap (composer), `motion` (springs), i18next | Mature, headless primitives let the glass design be fully custom |
| Styling | **CSS Modules + PostCSS nesting + a CSS-variable token system. No Tailwind, no component kit** | Glass needs hand-built layers; also avoids the default templated look |
| Ambient layer | `ogl` (tiny WebGL) shader with pure-CSS fallback | Section 7.3 |
| Design system | Storybook with visual snapshots | Glass regressions are visual |
| Testing | Vitest, fast-check, Testcontainers, Playwright (`_electron`), k6 | Section 10 |
| Lint/format | Biome + `tsc --noEmit`; commitlint (gitmoji rule) + lefthook | Fast hooks |
| Observability | pino, `prom-client`, optional compose profile with Prometheus + Grafana | Operable by one person |

**Why not Tauri:** it uses the OS webview (WebView2 / WebKitGTK). WebRTC and `backdrop-filter` behave inconsistently, especially on Linux WebKitGTK. The glass design and screen share need Chromium everywhere. Record this in ADR-0002.

---

## 4. Repository layout

```
/
├─ CLAUDE.md                     # ≤200-line index for the agent (commands, map, conventions, gotchas)
├─ docs/
│  ├─ BRIEF.md                   # this brief, verbatim, never edited by the agent
│  ├─ PLAN.md                    # living roadmap with checkboxes
│  ├─ PROGRESS.md                # handoff log (what's done, what's next, blockers)
│  ├─ PLATFORM-LIMITS.md
│  ├─ DESIGN-CHECKLIST.md
│  ├─ RUNBOOK.md
│  ├─ adr/NNNN-title.md
│  └─ spec/<feature>.md          # one spec per feature, written before implementation
├─ apps/
│  ├─ server/                    # api/, gateway/, workers/, modules/<domain>/
│  └─ desktop/                   # main/, preload/, renderer/
├─ packages/
│  ├─ protocol/                  # zod schemas, REST types, gateway opcodes + events
│  ├─ permissions/               # pure permission engine (bigint bitfield)
│  ├─ markdown/                  # chat-markdown parser → AST (no HTML strings)
│  ├─ ui/                        # glass design system + Storybook
│  ├─ widgets/                   # widget schema + renderers
│  └─ config/                    # tsconfig, biome, shared presets
├─ infra/
│  ├─ docker-compose.dev.yml
│  ├─ docker-compose.prod.yml
│  ├─ caddy/  livekit/  postgres/
│  └─ scripts/                   # deploy.sh, backup.sh, restore.sh
├─ .claude/                      # agents/, commands/, settings.json (hooks)
└─ .gitlab-ci.yml
```

Server modules (`apps/server/src/modules/`): `auth`, `users`, `relationships`, `channels`, `messages`, `guilds`, `roles`, `invites`, `voice`, `media`, `emotes`, `profiles`, `widgets`, `presence`, `notifications`, `search`, `moderation`, `admin`. Each module owns its routes, service, repository and tests; cross-module calls go through service interfaces, never through another module's tables.

---

## 5. Architecture

### 5.1 Conventions
- **IDs:** 64-bit time-sortable Snowflakes generated in-app (custom epoch, worker id from config). Stored as `bigint`, serialized as **strings** in JSON.
- **API:** REST under `/api/v1`, JSON, cursor pagination (`before`/`after`/`limit`), consistent error envelope with machine codes, idempotency keys on message create, OpenAPI generated from schemas and published at `/api/v1/openapi.json`.
- **Time:** UTC timestamps (`timestamptz`), ISO-8601 on the wire.
- **Config:** one validated `env.ts` (Zod); the app refuses to boot on invalid config.
- **Soft vs hard delete:** messages and accounts support real deletion (GDPR); keep tombstones only where needed for thread integrity.

### 5.2 Data model essentials
Users, sessions/devices, credentials (password, TOTP, WebAuthn), relationships (friend/block/pending), channels (dm, group_dm, guild_text, guild_voice, guild_category, announcement, thread), channel members, messages (+ attachments, embeds, reactions, pins, mentions, edit history), read states, guilds, members, roles, role assignments, channel permission overwrites, invites, bans, audit log, emotes, stickers, badges + awards, profiles, profile widgets, activities, themes, reports, instance settings.
Index messages on `(channel_id, id DESC)`. Design for later partitioning of `messages` (by channel hash or time) but do not partition on day one.

### 5.3 Gateway protocol (WebSocket)
Discord-style, versioned (`/gateway/v1`):
- Opcodes: `HELLO`, `IDENTIFY`, `READY`, `HEARTBEAT`, `HEARTBEAT_ACK`, `RESUME`, `DISPATCH`, `RECONNECT`, `INVALID_SESSION`, `SUBSCRIBE` (lazy subscriptions).
- Every `DISPATCH` carries a monotonically increasing sequence number. Sessions buffer events (Valkey streams, ~5 minute window) so `RESUME` replays what was missed after a network blip.
- Compression (`permessage-deflate` or zstd if verified stable), strict payload size limits, per-connection rate limits.
- **Lazy fan-out:** guild member lists and presence are subscribed per visible range, not pushed wholesale. Presence goes only to friends and users sharing a guild, throttled and coalesced.
- Horizontal-ready: all cross-process fan-out through Valkey pub/sub from day one, even though v1 runs a single process.
- Auth: access token in `IDENTIFY`, never in the URL.

### 5.4 Permission engine (`packages/permissions`)
Pure, dependency-free, exhaustively tested; used by server (authoritative) and client (UI hints only).
- 64-bit `bigint` bitfield; permission set documented in `docs/spec/permissions.md` (view channel, send, embed, attach, react, external emotes, mention everyone, manage messages/channels/roles/guild/emotes, kick/ban/timeout, view audit log, invite, connect, speak, video, stream, use VAD, priority speaker, mute/deafen/move members, administrator…).
- Resolution order: owner → administrator → base (`@everyone` + member roles) → channel overwrites in order (`@everyone`, then roles aggregated, then member), with the implicit rule that without view permission nothing else applies.
- Role hierarchy rules for who may modify whom/what.
- Property-based tests (fast-check) for: monotonicity, overwrite precedence, admin bypass, hierarchy, and no privilege escalation through role edits.
- **Every** mutating endpoint and every gateway subscription calls the engine. Add a test helper that fails CI if a route is registered without declaring its permission requirement.

### 5.5 Voice & video
- One LiveKit room per voice channel / DM call / group call. Room name = channel id (+ call epoch for DMs).
- The API issues short-lived LiveKit tokens only after a permission check (`CONNECT`, `SPEAK`, `VIDEO`, `STREAM`). Publish grants per source (mic, camera, screen, screen-audio) are derived from permissions.
- Voice state (who is in which channel, mute/deafen/self-state) is owned by the gateway/voice module and reconciled with LiveKit via webhooks, so crashes and ungraceful disconnects self-heal.
- Server mute/deafen/move uses LiveKit server APIs plus gateway events.
- Simulcast + dynacast + adaptive stream by default. Defaults: camera ≤720p30, screen share ≤1080p30 (configurable), configurable per-channel max video participants. Document the bandwidth math for the VPS in `docs/spec/voice.md` (SFU downstream = senders × receivers × bitrate).
- Audio: echo cancellation, noise suppression, auto gain via `getUserMedia` constraints; optional RNNoise (WASM AudioWorklet) toggle; voice activity detection or push-to-talk; per-user local volume (0–200%); input/output device pickers; speaking indicator driven by real audio levels.
- Screen share: `desktopCapturer` + `setDisplayMediaRequestHandler` with an in-app glass source picker; Windows system-audio loopback; Linux/Wayland via xdg-desktop-portal + PipeWire (verify required Chromium flags in current Electron docs).
- Optional later: E2EE for DM/group calls via LiveKit's E2EE support.

### 5.6 Media
- Uploads: authenticated, size-limited, streamed to storage (resumable chunked uploads for large files), content-type sniffing (never trust the client MIME), per-user and per-instance quotas.
- Images via `sharp`: strip EXIF/GPS, generate thumbnails and blurhash, preserve animation for GIF/WebP/APNG. Video: poster frame + metadata via `ffmpeg`. SVG uploads rejected (or rasterized).
- User content is served from a **separate origin** (`cdn.<DOMAIN>`) with `X-Content-Type-Options: nosniff`, `Content-Disposition` where appropriate, and immutable caching by content hash.
- Link previews: server-side unfurl with SSRF protection (section 8.3) and an image proxy so clients never connect to third-party hosts directly.
- GIFs: `GifProvider` interface. At implementation time **verify which providers are alive and what their terms are** (don't assume Tenor still works). Implement Giphy first via API key from env, keep the interface open for others. Also support personal GIF favorites and uploading GIFs as emotes.

### 5.7 Search
Postgres FTS (`tsvector` with French and English configs) + `pg_trgm`, behind a `SearchProvider` interface so Meilisearch can slot in later. Filters: `from:`, `in:`, `has:`, `before:`/`after:`, `mentions:`. Results must respect permissions (filter by channels the searcher can view).

### 5.8 Email
Nodemailer over SMTP (env-configured; Mailpit in dev compose). Verification, password reset, new-device login alerts.

---

## 6. Feature specification

Write `docs/spec/<feature>.md` before implementing each; keep it short, concrete, testable.

### 6.1 Accounts & sessions
- Register / login with email + password (**Argon2id**), email verification, password reset.
- Registration modes: open / invite-only / closed (instance setting); first account becomes instance admin.
- TOTP 2FA with recovery codes; **passkeys (WebAuthn)** via `@simplewebauthn`.
- Short-lived access JWT + rotating refresh token with **reuse detection**; refresh token stored in the OS keychain via Electron `safeStorage`.
- Device/session list with revoke; "log out everywhere"; new-device email.
- Account deletion and **data export** (GDPR); minimum-age acknowledgement at signup (15 for France).
- Username (unique, lowercase handle, changeable with cooldown) separate from display name.

### 6.2 Relationships
Friend requests (by username), accept/decline/cancel, remove, block (hides content, blocks DMs and calls), per-user private nickname and note, mutual friends and mutual servers views, privacy settings (who can friend-request / DM).

### 6.3 Messaging
DMs and group DMs (max members configurable, default 10), with calls in both. Guild text channels, announcement channels, threads, pins.
Messages: markdown subset (bold, italic, underline, strike, code, code blocks with syntax highlighting, quotes, spoilers, lists, headers, links, masked links, timestamps, mentions `@user @role @everyone #channel`), replies, edits (with edited marker), deletes, reactions (unicode + custom), attachments, embeds, stickers, typing indicators, read states + unread/mention badges, jump-to-message, message search, forwarding, scheduled/pending send with optimistic UI and failed-send retry.
Composer: Tiptap-based with inline emote rendering, `:` emote autocomplete, `@`/`#` autocomplete, paste/drag-and-drop uploads, draft persistence per channel.
Message list: virtualized, stable scroll anchoring, smooth jump-to, 60 fps with large histories.
Density modes: **Cozy**, **Compact**, **Bubble** (iMessage-like, offered for DMs).

### 6.4 Servers (guilds)
Create/join via invite (expiry, max uses, temporary membership), categories and channels (text, voice, announcement), reorder via drag, roles (colors, icons, hoist, mentionable) with the section 5.4 engine, channel overwrites UI, member list with role grouping, per-server nickname and avatar, moderation (kick, ban with message purge, timeout), audit log, server emotes and stickers, server icon/banner/accent, welcome screen, light AutoMod (rate-spam, link and word filters), ownership transfer, templates.
Two sidebar layouts: **Chat layout** (Discord-style) and **Tree layout** (TeamSpeak-style persistent channel tree with voice users nested under channels, compact rows, always-visible voice dock).

### 6.5 Voice / video / calls
Voice channels, DM and group-DM calls (ringing, accept/decline, missed-call notice), mute/deafen, server mute/deafen, push-to-talk with configurable keybind, VAD sensitivity, per-user volume, camera, screen share (window/screen, with audio), spotlight/grid layouts, active-speaker detection, pop-out call window, persistent voice dock while browsing other channels, connection quality indicator, automatic reconnect, "join with" device preflight.
Push-to-talk uses a global key hook (e.g. `uiohook-napi`, prebuilt binaries only) on Windows and X11. **On Wayland global key capture isn't available**: fall back to the XDG GlobalShortcuts portal if Electron supports it at that time, otherwise in-focus-only PTT with a visible notice. Log it in `docs/PLATFORM-LIMITS.md`.

### 6.6 Emotes & stickers
Per-server custom emotes (static + animated, size/count limits, upload with crop/preview), stickers, a bundled unicode emoji set (license-checked, e.g. Noto Emoji or Twemoji graphics with correct attribution), picker with search/recents/skin tones, cross-server emote use gated by permission, reactions with a "pop" animation.

### 6.7 Profiles
Avatar (animated allowed), **banner** (image/animated or solid), username + display name, **pronouns**, **status** (online / idle / DnD / invisible) + **custom status** (text + emoji + expiry), **bio** (chat-markdown subset), accent color, **badges**, **activity**, mutual friends/servers, member-since, per-server profile overrides (nickname, avatar, bio).
- **Badges:** data-driven `badge_definitions` (icon asset, name, description, rarity) awarded manually by admins or by automatic rules (early member, account anniversary, server owner, etc.). Users pin up to N badges.
- **Activity status** with four sources, each independently toggleable for privacy: (1) manual "Playing/Listening/Watching" text; (2) opt-in game detection via a local process allowlist file the user can extend; (3) a **local RPC** (named pipe on Windows / unix socket on Linux, versioned, documented in `docs/rpc.md`) so other apps can set rich presence; (4) opt-in "listening to" via OS media session (Windows SMTC / Linux MPRIS).
- Profile popout (quick card) and full profile view; both glass-styled, banner-color-tinted.

### 6.8 Custom profile widgets
Goal: users compose their profile page from widgets, safely.
- **Tier A (v1, no user code):** declarative widgets. A versioned JSON schema (`packages/widgets`), validated server-side, rendered by first-party React components. Catalog: rich text/markdown, image/gallery, stat tile, progress/goal bar, link buttons, countdown, local-time-and-timezone clock, quote, badge shelf, mutual servers, "now playing"/activity, status board, short voice-intro clip, pixel-art canvas, and **integration cards** via a provider interface (ship at least two, e.g. GitHub and ListenBrainz/Last.fm; providers fetch server-side with caching and SSRF protection).
- Layout: 12-column grid, drag/resize in a live-preview editor, sizes 1×1 to 4×3, max 12 widgets and a payload cap, per-widget visibility (everyone / friends / mutual servers / only me), reorder, duplicate, import/export JSON.
- Widgets inherit the glass design system and the viewer's theme, with per-widget tint from a constrained token set (no arbitrary CSS).
- **Tier B (phase 9, instance-gated):** scripted widgets in a sandboxed iframe (`sandbox` without `allow-same-origin`, separate origin, strict CSP, typed `postMessage` API, no direct network, CPU/time limits, report/takedown flow). Do not build Tier B before Tier A is solid.

### 6.9 Theming
Theme = JSON token set (colors, tint, glass blur strength, glass opacity, corner radius scale, motion intensity, font scale, density). Presets (section 7.5), custom wallpaper/ambient colors, per-server accent, light/dark/auto, import/export, live preview. A **contrast guard** in the theme editor warns when text/glass combinations fall below WCAG AA (4.5:1). Custom CSS is **not** in v1.

### 6.10 Notifications & desktop integration
Native notifications (respect DnD and per-channel/server mute), tray icon + unread badge/taskbar overlay, flash on mention, `{{APP_SLUG}}://` deep links (invites), single-instance lock, start-on-login and start-minimized options, close-to-tray, global shortcuts, auto-update (section 9.5).

### 6.11 Settings, i18n, accessibility
Full settings surface (account, privacy, appearance, notifications, voice & video, keybinds, activity privacy, language, advanced). **i18n from day one** (EN + FR, ICU messages, no hardcoded strings). Accessibility: full keyboard navigation, focus rings that fit the glass style, screen-reader labels/roles, `prefers-reduced-motion` and `prefers-reduced-transparency` honored plus in-app equivalents, high-contrast theme, scalable text.

### 6.12 Admin & moderation
Instance admin panel (inside the client, gated by instance-admin flag): users, invites, registration mode, badges, reports queue, storage usage, instance health, announcements. User reports (message/user/server/widget) with a review queue. Everything admin-initiated is audit-logged.

### 6.13 Phase-9 stretch
Public bot API (bot tokens, webhooks, slash commands, OAuth2), soundboard, stage channels, forum channels, scripted widgets (Tier B), custom-CSS themes behind a strict CSP, E2EE for DMs (MLS) and calls, Flatpak, macOS build (codebase should not preclude it).

---

## 7. UI direction: liquid glass, deliberately not "AI default"

### 7.1 Concept
Apple "liquid glass" language adapted to a chat app, with Discord's information architecture and TeamSpeak's voice-first density options.

- **Two layers.** A calm **content layer** (messages, member lists, profile content) and a floating **glass layer** (server rail, channel sidebar, top bars, composer, popovers, modals, tooltips, voice dock, context menus). Glass is for navigation and controls. Message text sits on a quieter, more opaque surface so it stays legible.
- Glass must always have something to refract. The app renders its own **ambient layer** (7.3) behind everything, so the effect looks identical on every OS regardless of desktop wallpaper.
- Shapes are concentric and fluid: squircle-ish rounded rectangles, radii nested consistently (outer 28 → inner 20 → inner 14 → inner 10), pill controls, nothing sharp.
- Surfaces feel lit: top-edge specular rim, soft inner glow, pointer-reactive highlight, subtle noise grain, tinted shadows (never pure black).

### 7.2 The Glass primitive (`packages/ui`)
Build one `<Glass>` component and `useGlass` hook; everything else composes it.
Layers, bottom to top: backdrop blur/saturate/brightness → tint overlay (theme tint at low alpha) → inner shadow/glow → **specular rim** (1px gradient border masked to edges, brighter at the top-left, light follows pointer via `--mx/--my` CSS variables updated in `requestAnimationFrame`) → noise grain.
Starting values (tune by eye and screenshot, they are not sacred): blur 16 / 28 / 44 px for levels 1 / 2 / 3, `saturate(165–185%)`, rim `rgba(255,255,255,0.16–0.28)`, tint alpha 0.06–0.18, shadow `0 8px 32px` tinted from the ambient hue.

Quality tiers (setting: **Auto / High / Low / Solid**):
- **High:** adds Chromium-only SVG displacement refraction (`backdrop-filter: url(#…)` with `feDisplacementMap`) on a small number of small floating elements (pills, toggles, tooltips, voice dock, active-tab indicator), generated per element size. Prototype first; confirm behavior in the Electron version in use.
- **Low:** blur + tint + rim, no refraction, fewer layers.
- **Solid:** opaque themed surfaces (also used when `prefers-reduced-transparency`).
- **Auto:** a frame-time governor downgrades tiers when the GPU struggles and restores when idle; pause all ambient animation when the window is unfocused or minimized.
Rules: never nest `backdrop-filter` elements; cap concurrent refractive elements (~10); only animate `transform` and `opacity`; no layout-thrashing animations.

### 7.3 Ambient layer
A WebGL mesh-gradient/aurora shader (`ogl`) behind the app, with colors derived from the active theme and, optionally, the current server's accent or the open profile's banner/avatar dominant color (extract server-side with `sharp`, cache). Animated slowly; 30 fps cap; paused when hidden; pure-CSS gradient fallback. Users can swap it for a static wallpaper or solid color.

### 7.4 OS-level materials
- **Windows 11:** prefer Electron's `backgroundMaterial` (`'acrylic'`/`'mica'`) with a frameless window and `titleBarStyle: 'hidden'` + `titleBarOverlay`, **not** `transparent: true`. Electron documents that transparent windows are not resizable, can't be maximized via the system menu, have no native shadow, and lose transparency when DevTools is open. Verify against current docs.
- **Windows 10 and Linux:** no OS blur behind the window. Use in-app glass over the ambient layer (this is the cross-platform baseline). On Wayland, frameless windows get GTK shadows; handle with `hasShadow` as documented. Wayland compositors expose blur through compositor-specific protocols that Electron doesn't surface, so do not promise it.
- Linux Wayland: set the Ozone platform hint to auto and verify the decoration and screen-capture flags against current Electron docs at implementation time.

### 7.5 Themes, palette, typography
Default themes (token files in `packages/ui/themes/`):
- **Aurora** (default dark): deep ink-blue base (~`#0A0C16`), ambient cyan `#4FD8FF`, violet `#8B7BFF`, magenta `#FF6BD6`, accent `#6C8CFF`.
- **Frost** (light): cool white-blue base, soft sky/lilac ambient, desaturated accent.
- **Midnight Ember**, **Tide**, **Mono Glass** (grayscale, high contrast), **Sakura Night**.
Avoid cream/beige/terracotta, purple-gradient-on-white, and generic "SaaS dark mode".
Typography: **Figtree** (variable) for UI and chat, **JetBrains Mono** for code, both bundled locally (no CDN; GDPR and offline). Type scale on a 4px baseline, tabular numerals for counters and timestamps.
Spacing on a 4px grid. Icons: one consistent family (e.g. Phosphor), duotone/regular weights, bundled.

### 7.6 Motion: smooth, springy, bubbly (not gimmicky)
Use `motion` springs everywhere; no linear or default ease on interactive elements.
- Press: scale 0.96 → overshoot 1.02 → 1, spring stiffness ~380–520, damping ~22–30 (tune).
- Server icon: squircle ↔ circle morph on hover/active; the selection pill grows and slides with shared-element (`layoutId`) transitions.
- Active-tab/segment indicators are liquid pills that stretch toward their target.
- Lists: staggered entrance; messages slide-fade in; reactions pop; send action has a small launch animation.
- Modals/popovers scale from their anchor with blur-in; route changes cross-fade with slight depth shift.
- Voice: speaking ring and glow pulse with the real audio level; join/leave animations on avatars.
- Respect reduced-motion: swap springs for short fades. A global **motion intensity** slider scales amplitudes.
- Budget: interactions respond in <100 ms, animation frames ≤16.6 ms on a mid laptop.

### 7.7 Layout
Chat layout: server rail (left) · channel sidebar · main content · collapsible member list/profile panel (right) · user panel with mic/deafen/settings docked bottom-left of the sidebar. Tree layout: TeamSpeak-style channel tree with voice users inline. Resizable panes, window state remembered, compact density available.

### 7.8 Anti-"AI-generated look" rules (hard requirements)
<ui_hard_rules>
- **Nothing in this brief is UI copy** unless it is in double quotes. Never echo requirements, adjectives or design intent from the brief as taglines, subtitles, helper text, empty-state blurbs or section descriptions.
- Every string in the UI must be a control label, a data value, a unit, an action, or copy explicitly specified in `docs/spec/`. No subtitle under a title unless it carries data. Text budget: labels ≤3 words; no explanatory sentences outside settings help and error messages.
- Banned patterns: small uppercase letter-spaced "eyebrow" labels, numbered section markers (01/02/03), pill badges used as decoration, icons-in-tinted-squares feature grids, fake stats, decorative gradient text, italic-serif hero words, perfectly uniform card grids, uniform spacing everywhere (hierarchy needs rhythm and contrast), emoji as icons, placeholder lorem or "Welcome back!" style filler.
- Hierarchy comes from scale, weight, density contrast and light, not from boxing everything in cards.
- Before any UI task is declared done, run the subtraction pass: list every non-interactive, non-data text node and justify or delete it.
</ui_hard_rules>

---

## 8. Security

### 8.1 Baseline
Target OWASP ASVS Level 2. Threat model in `docs/spec/threat-model.md` (written in phase 1, revisited each phase). Rate limits on every route and gateway op (token bucket in Valkey, per user + per IP, stricter on auth, uploads, invites, friend requests). Argon2id (`@node-rs/argon2`), optional HIBP k-anonymity password check. Validate **all** inputs with Zod at the boundary. Secrets via env/Docker secrets (optionally sops+age), `.env` never committed, `.env.example` always current.

### 8.2 Electron hardening (checklist, enforced by a test)
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; strict CSP; minimal typed `contextBridge` API in preload; every IPC handler validates input with Zod and verifies the sender frame; `setWindowOpenHandler` denies by default (external links open in the OS browser after validation); block `will-navigate` to foreign origins; permission request/check handlers allow only media/display-capture/notifications for the app origin; no `remote`; flip **fuses** (`RunAsNode` off, `NodeOptionsEnvironmentVariable` off, cookie encryption on, `OnlyLoadAppFromAsar` on, ASAR integrity validation on); updates verified by signature; tokens only in `safeStorage`.

### 8.3 SSRF & user content
Link unfurl, image proxy and widget integration fetchers must: resolve DNS themselves, block private/loopback/link-local/metadata ranges (v4 and v6), pin the resolved IP for the connection (anti-rebinding), cap redirects, size and time, allow only http(s), and run in a worker with no access to secrets. User-uploaded files are served from the CDN origin, never the API origin.

### 8.4 Abuse & privacy
Reports + moderation tooling, upload quotas, optional ClamAV scan hook (compose profile), audit logs for privileged actions, minimal data retention, data export/delete endpoints, IP addresses stored only for sessions with a retention limit.

---

## 9. Infrastructure: OVH VPS

### 9.1 Topology (Docker Compose)
Services: `caddy`, `api` (REST + gateway; split later), `worker`, `postgres`, `valkey`, `livekit`, `garage` (or external S3), optional `mailpit` (dev), optional `prometheus` + `grafana`, optional `clamav`. Named volumes for data; healthchecks on every service; restart policies; resource limits to avoid one service starving voice.

### 9.2 Network
Single `<DOMAIN>` with subdomains: `api.`, `gw.`, `cdn.`, `lk.` (LiveKit signal), `turn.`, `updates.`.
LiveKit needs UDP/TCP reachability for media: prefer the **single UDP port** mode plus TCP fallback plus embedded TURN (UDP 3478, TLS 5349 or 443 via SNI). **Read LiveKit's current self-hosting and firewall docs for exact ports and config keys; do not rely on memory.** Open only required ports (ufw/nftables; also review OVH's network firewall). Caddy terminates TLS for HTTP/WS; LiveKit's TURN/TLS needs its own certificate handling, so follow the docs.

### 9.3 Host hardening
SSH keys only, root login off, non-default user, fail2ban or equivalent, unattended security upgrades, time sync, Docker daemon hardening, no services bound to public interfaces unless required.

### 9.4 Backups & recovery
Nightly `pg_dump` (plus WAL archiving if feasible) and object-store sync via restic to OVH Object Storage (or another off-box target), encrypted, with retention policy, and a **tested restore script**. Restore drill documented in `docs/RUNBOOK.md` and run once before declaring phase 8 done.

### 9.5 Releases & updates
`electron-builder`: NSIS installer for Windows; AppImage, deb, rpm for Linux. `electron-updater` with a generic provider served from `updates.<DOMAIN>`; staged channels (`stable`, `beta`). Unsigned Windows builds trigger SmartScreen warnings: document this, wire the signing step to env-provided certificate so it can be enabled later. Build Windows installers on a Windows runner (or document the Wine route). Deploys: `infra/scripts/deploy.sh` (pull, migrate, rolling restart, health check, auto-rollback on failed healthcheck).
If SSH access to the VPS is provided, deploy; otherwise produce exact copy-paste setup instructions in `docs/RUNBOOK.md`. Never run destructive commands on the VPS without explicit human confirmation.

---

## 10. Quality standards

### 10.1 Coding standards
- Strict TS, no `any` (use `unknown` + narrowing), no non-null assertions outside tests, no `// @ts-ignore` (use `@ts-expect-error` with a reason).
- Functions small and single-purpose; modules cohesive; no circular dependencies (enforce with a lint rule/madge in CI).
- Domain logic in services, I/O in repositories/adapters, transport in controllers. No business logic in route handlers or React components.
- Parse, don't validate: convert unknown input into typed domain values at the edge.
- Errors: typed error classes with machine codes; never swallow; never leak internals to clients.
- Comments explain *why*, not *what*. Public package APIs have TSDoc.
- Naming: descriptive, no abbreviations except domain-standard (`id`, `url`, `rtc`). Files kebab-case; React components PascalCase; one component per file.
- React: function components, hooks, state close to where it's used, derive instead of sync, memoize only with measured need, no data fetching in components without Query, accessibility attributes mandatory on interactive elements.
- DB: migrations are forward-only and reviewed; every FK and query path has an index justified in the spec; no `SELECT *`; transactions where invariants span rows.
- Dependencies: add deliberately; check license (permissive only), maintenance, size; pin exact versions; never invent a version number, verify against the registry; run `pnpm audit` in CI.
- No dead code, no commented-out code, no TODO without an issue entry in `docs/PLAN.md`.

### 10.2 Testing
- **Unit:** Vitest. Permission engine, markdown parser, protocol schemas, rate limiter, widget schema: property-based where sensible (fast-check).
- **Integration:** Testcontainers (real Postgres + Valkey). Every REST route has success, validation-failure, authz-failure and rate-limit tests.
- **Gateway:** protocol conformance tests (identify, heartbeat, resume replay, invalid session, lazy subscriptions) and a k6/custom load script (target 2,000 concurrent sockets on 2 vCPU).
- **E2E:** Playwright driving the real Electron app against a Compose test stack: signup → friend → DM → create server → permissions → voice join (fake media devices) → profile edit → widget edit.
- **Visual:** Storybook snapshots for the glass system in each tier and theme; screenshot suite for key screens (`pnpm ui:shots`).
- **Voice:** automated two-participant fake-media join test; manual cross-network checklist in `docs/spec/voice.md`.
- Bug fix = failing test first, then fix.

### 10.3 Performance budgets
Cold start to interactive window ≤2.5 s on a mid laptop; idle CPU ≤2%; typical RAM ≤500 MB; message list scroll at 60 fps with thousands loaded; message send p95 ≤150 ms server-side; gateway 2k concurrent sockets on 2 vCPU; voice join ≤1.5 s; glass frame time ≤16.6 ms in High tier on integrated GPUs (governor degrades otherwise). Measure, record in `docs/PERF.md`, regress-test.

---

## 11. Agentic workflow

### 11.1 Session start routine (every session, every resume)
1. Read `CLAUDE.md`, `docs/PROGRESS.md`, and the current phase in `docs/PLAN.md`.
2. `git status`, `git log --oneline -20`, current branch.
3. Run `pnpm verify` to establish a green baseline. If it's red, fix that first.
4. Pick the next unchecked task; read its spec in `docs/spec/`.

### 11.2 Task loop
**Spec → Plan → Test → Build → Verify → Review → Commit → Log.**
1. If no spec exists, write `docs/spec/<feature>.md` (goal, data model, API, events, permissions, edge cases, acceptance criteria).
2. Plan the smallest vertical slice (schema → protocol types → server → client) and write it into the task list.
3. Write failing tests for the behavior; implement; run `pnpm verify`.
4. Run the thing for real (server up, client launched) and exercise the feature.
5. UI work: run the visual loop (11.4).
6. Review your own diff as a hostile reviewer (or invoke the `reviewer` subagent) before the commit.
7. Commit per section 12; update `docs/PLAN.md` checkbox and append to `docs/PROGRESS.md` (3–5 lines: what changed, what's next, any gotcha).

### 11.3 Files the agent must create and maintain (phase 0)
- `docs/BRIEF.md`: this brief, verbatim, never edited.
- `CLAUDE.md`: ≤200 lines. Commands, architecture map, conventions, "gotchas learned the hard way", pointers into `docs/`. Updated whenever a convention or gotcha is discovered. Keep it terse; it is loaded every session.
- `docs/PLAN.md`: phases and tasks as checkboxes with acceptance criteria.
- `docs/PROGRESS.md`: newest-first handoff log.
- `docs/adr/`: one ADR per significant decision (context, options, decision, consequences). ADR-0001 assumptions, ADR-0002 Electron vs Tauri, ADR-0003 monorepo and tooling, then as needed.
- `.claude/agents/` (if the harness supports it): `architect` (design + ADRs), `reviewer` (read-only diff review against this brief's standards), `security-auditor` (Electron, authz, SSRF, uploads), `design-critic` (screenshots vs `DESIGN-CHECKLIST.md`), `test-engineer`.
- `.claude/commands/`: `/verify`, `/phase-start`, `/ship-phase` (full verify + reviewer + security pass + tag).
- `.claude/settings.json` hooks: format on file write; block `git push --force`, `git commit --no-verify`, destructive `rm -rf` outside the repo; run typecheck on stop.
- `pnpm` scripts: `dev`, `verify` (lint + typecheck + affected unit tests), `verify:full` (adds integration + e2e), `ui:shots`, `db:migrate`, `db:seed`, `release`.
Use subagents for focused, parallelizable work (research a library, review a diff, audit security, write a test suite); keep the main thread for integration and decisions. Don't spawn subagents for trivial steps.

### 11.4 Visual verification loop (UI work)
1. `pnpm ui:shots` launches the app (Playwright `_electron`), visits key screens/states in each theme and quality tier, and writes PNGs to `.artifacts/shots/` (git-ignored).
2. View the screenshots. Critique against `docs/DESIGN-CHECKLIST.md`: legibility and contrast, glass depth and rim lighting, hierarchy, spacing rhythm, motion states, the section 7.8 rules.
3. Fix and re-shoot. At most three iterations per task; remaining polish goes to a "polish" item in `PLAN.md`.
4. Motion can't be judged from stills: record short Playwright video/trace for animated components and review frame samples.

### 11.5 Definition of done (per task)
Spec acceptance criteria met · tests written and passing · `pnpm verify` green · feature exercised in the running app · authorization and rate limits covered · i18n strings extracted (EN + FR) · accessibility checked · no new lint/type warnings · docs, ADR, PLAN and PROGRESS updated · committed per policy.
Phase done additionally: `verify:full` green · `reviewer` and `security-auditor` pass with findings resolved · tag created · deploy to the staging/VPS stack when infra exists.

### 11.6 Escalation: ask the human only when
- credentials, API keys, SMTP, DNS/domain, signing certificate or SSH access are required;
- a spend or paid service is involved;
- an action is destructive or irreversible on remote systems;
- a product decision changes the data model irreversibly and the spec doesn't answer it;
- the same blocker has defeated three distinct approaches (log it in `PROGRESS.md`, mark the task blocked, continue with the next unblocked task rather than looping).
Everything else: decide, record in an ADR, proceed.

### 11.7 Context hygiene
Keep `CLAUDE.md` lean. Don't paste large files into the conversation; read ranges. Summarize long investigations into the relevant spec or ADR and move on. Prefer re-reading files over remembering them. Before a long autonomous stretch, write the plan to `PROGRESS.md` so a fresh session could continue.

---

## 12. Git & commit policy

### 12.1 Format (gitmoji)
```
<gitmoji> <scope>: <imperative subject, ≤72 chars, no trailing period>

<optional body: why, not what; wrap at 80>

<optional footers: Refs: docs/spec/x.md · BREAKING CHANGE: … · Closes: …>
```
- Exactly one gitmoji (the Unicode character, not the `:shortcode:`), then a lowercase scope, a colon, a space, an imperative subject.
- Scopes: `server gateway auth db permissions protocol markdown desktop ui voice media profile widgets theme i18n infra ci docs deps repo`.
- Enforced by a `commit-msg` hook (lefthook + commitlint with a custom gitmoji/scope rule) and again in CI.

Examples:
```
🎉 repo: initialize pnpm monorepo with turborepo and biome
🗃️ db: add messages table with snowflake ids and channel index
🏷️ protocol: define gateway opcodes and dispatch event schemas
✨ gateway: support session resume with sequence replay
🛂 permissions: implement channel overwrite resolution
✅ permissions: add property tests for overwrite precedence
💄 ui: add glass surface primitive with specular rim
💫 ui: spring squircle morph on server icon hover
🔒️ desktop: enable electron fuses and validate ipc senders
🌐 desktop: extract chat composer strings to fr locale
🐛 voice: reconcile stale voice state on livekit participant_left
⚡️ ui: cap concurrent refractive elements via frame governor
⬆️ deps: bump livekit-client to <verified version>
👷 ci: add gitlab pipeline for verify and e2e
🔖 repo: release v0.4.0 voice and video
```

### 12.2 Gitmoji map (use the most specific one)
✨ new feature · 🐛 bug fix · 🩹 trivial fix · 🚑️ critical hotfix · ♻️ refactor · 🎨 code structure/format · ⚡️ performance · 🔒️ security fix · 🔐 secrets/config secrets · 🛂 authz/roles/permissions · 🦺 validation · 🥅 error handling · ✅ add/update tests · 🧪 add a failing test · 📝 docs · 💄 UI/styling · 💫 animations/transitions · ♿️ accessibility · 🌐 i18n · 💬 text/literals · 🗃️ database/migrations · 🌱 seed data · 🏷️ types · 🔧 configuration · 🔨 dev scripts · 🧑‍💻 developer experience · 👷 CI build system · 💚 fix CI · 🧱 infrastructure · 🚀 deploy · 📦️ packaging/build artifacts · ⬆️ upgrade deps · ⬇️ downgrade deps · ➕ add dep · ➖ remove dep · 📌 pin dep · 🚚 move/rename · 🔥 remove code/files · 💥 breaking change · 🔊 add logs · 🔇 remove logs · 🩺 healthcheck · 🧵 concurrency · 🚩 feature flags · 🙈 gitignore · 🍱 assets · 🤡 mocks · ⏪️ revert · 🔀 merge · 🔖 release/version tag · 🎉 begin project.
Avoid 🚧 on any branch that gets merged.

### 12.3 Commit discipline
- **Atomic and logical.** One commit = one coherent change that builds and passes lint, typecheck and the tests of touched packages. Never commit a red tree.
- **Segment by concern.** Typical order inside a feature: 🗃️ schema/migration → 🏷️ protocol types → ✨ server logic → ✅ tests (or tests first) → ✨ client logic → 💄/💫 visual layer → 🌐 strings → 📝 docs. Never mix formatting or refactors with behavior changes; never mix dependency bumps with feature work.
- **Frequency.** Commit as soon as a logical unit is green. If ~30–45 minutes of work has no commit, you've bundled too much, so split. Expect dozens of commits per phase. Soft ceiling ~300 changed lines per commit unless it's generated or a pure move.
- **No squashing** of feature branches (preserve the logical history). Rebase locally to tidy (`fixup` + autosquash) *before* sharing; never rewrite pushed shared history; never force-push `main`; never `--no-verify`.
- **Branches:** `main` is always releasable. Work on `feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `chore/<slug>`; merge with `--no-ff` (🔀) or fast-forward after rebase. Tag each phase `v0.<phase>.0` with 🔖.
- Generated files (lockfile, migrations meta, OpenAPI snapshot) are committed with the change that caused them.
- Never commit secrets, `.env`, build output, `.artifacts/`, or large binaries (assets go through reviewed, size-checked commits; consider Git LFS for >2 MB).
- Body text explains the reason and trade-offs when the subject isn't self-evident. Breaking changes get a `BREAKING CHANGE:` footer and 💥.

---

## 13. Roadmap (phases with acceptance criteria)

Track every item as a checkbox in `docs/PLAN.md`. Deploy a real VPS stack **early** (end of phase 2) because voice and NAT behavior can't be validated on localhost.

**Phase 0 — Foundations.** Monorepo, tooling, hooks, CI skeleton, Compose dev stack (Postgres, Valkey, LiveKit dev, Mailpit, storage), `docs/` + `CLAUDE.md` + ADRs + `.claude/` setup, commit-msg hook enforcing gitmoji format. *Accept:* fresh clone → `pnpm i && pnpm dev` boots server + empty Electron window; `pnpm verify` green in CI.

**Phase 1 — Core platform + design system v1.** `packages/protocol`, env/config, auth (register/login/refresh rotation/sessions/email verify/TOTP), gateway skeleton (identify/heartbeat/resume), Electron shell (hardened, fuses, safeStorage, titlebar, tray), **Glass primitive + tokens + ambient layer + 3 themes + Storybook**, login/register screens. *Accept:* sign up, log in, see live gateway connection; glass renders in all tiers; security checklist test passes; threat model written.

**Phase 2 — Social & messaging.** Friends/blocks, DMs + group DMs, messages (markdown, replies, edit/delete, reactions with unicode), typing, presence, read states/unread badges, media uploads with image processing, composer, virtualized list, deploy to the OVH VPS (Caddy + TLS + backups job). *Accept:* two real clients on different machines chat in DMs through the VPS; scroll stays 60 fps on 10k-message seed.

**Phase 3 — Servers & permissions.** Guilds, categories, channels, invites, roles, the permission engine with property tests, channel overwrites UI, member list (lazy), moderation (kick/ban/timeout), audit log, threads/pins. *Accept:* permission matrix test suite green; route-without-permission-declaration CI check in place; invite flow works end to end.

**Phase 4 — Voice, video, calls.** LiveKit on VPS, token service, voice state + webhook reconciliation, voice channels, DM/group calls with ringing, device settings, PTT/VAD, screen share (Windows + Wayland path), grid/spotlight, voice dock, pop-out window, reconnect. *Accept:* 4-person call across different networks stable; server mute/move works; documented capacity numbers for the VPS.

**Phase 5 — Profiles & expression.** Full profile (banner, avatar, pronouns, status, bio, accent), badges system, activity (manual + game detection + local RPC + media session), custom emotes/stickers, GIF picker (verified provider), emoji picker, per-server profiles. *Accept:* profile popout and full view polished, privacy toggles honored server-side.

**Phase 6 — Widgets & theming.** Widget schema + renderers + editor (drag/resize, live preview) + two integrations; theme engine, editor with contrast guard, presets, import/export, wallpaper. *Accept:* a user can build, share and hide-per-audience a widget profile; invalid/malicious widget JSON is rejected by tests.

**Phase 7 — Polish & completeness.** Search, notification settings, tray/badges/deep links, full settings, i18n EN+FR complete, accessibility pass, Tree layout, bubble density, auto-update + Windows installer + Linux packages, performance pass against budgets. *Accept:* clean install on Windows 11 and a Wayland Linux session; update from vN to vN+1 works.

**Phase 8 — Hardening & operations.** Security audit pass (subagent + manual checklist), load tests, backup **restore drill**, monitoring dashboards, runbook, rate-limit tuning, GDPR export/delete verified, admin panel. *Accept:* restore drill executed from scratch; 2k-socket load test within budget; no high/critical findings open.

**Phase 9 — Stretch (only after 0–8 are done and stable).** Bots/webhooks/public API, soundboard, stage/forum channels, Tier B widgets, E2EE (MLS) for DMs and calls, Flatpak, macOS build.

---

## 14. Kickoff: do this first

1. Read this brief fully. Save it verbatim to `docs/BRIEF.md`.
2. Verify toolchain versions from registries and official docs (Node LTS, pnpm, Electron stable, LiveKit server, Postgres, Valkey, Caddy). Record the verified versions in ADR-0003.
3. Write ADR-0001 (assumptions from section 0) and ADR-0002 (Electron vs Tauri).
4. Initialize the repo, then immediately set up hooks so the commit policy is enforced from the very first commit. Use `🎉 repo: initialize …` as the first commit.
5. Create `CLAUDE.md`, `docs/PLAN.md` (all phases with checkboxes), `docs/PROGRESS.md`, `.claude/` agents/commands/hooks.
6. Execute Phase 0, then proceed through the roadmap following section 11. Report to the human only at escalation triggers and at phase boundaries (a short summary: what shipped, what's verified, what's next, anything blocked).
