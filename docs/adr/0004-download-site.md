# ADR-0004: Public download site for installers

- Status: accepted
- Date: 2026-10-17

## Context

The human asked for a simple website to download the installer, styled like the
app. The brief lists a public *web client* as a v1 non-goal; a download page is not a
client (no accounts, no chat) and does not conflict with that.

## Decision

- Add `apps/site`: a static, prerendered page built with Vite, reusing `packages/ui`
  tokens, themes and the ambient layer (CSS fallback by default; WebGL only if it
  stays within budget on a static page).
- It reads the `stable` channel feed that `electron-updater` already publishes on
  `updates.<DOMAIN>` (`latest.yml`, `latest-linux.yml`), so there is one source of
  truth for versions. OS detection picks the primary button; all artifacts stay listed.
- Served by Caddy at `<DOMAIN>` (and `get.<DOMAIN>`) from the production compose stack.
- No analytics, cookies or third-party requests; fonts bundled; EN + FR.
- Scheduled in phase 7, after installers and the update feed exist.

## Consequences

- `packages/ui` must keep its tokens and glass CSS usable without React-only runtime
  pieces, or the site imports React for a handful of components (acceptable).
- One more Caddy site block and build artifact in the deploy pipeline.
