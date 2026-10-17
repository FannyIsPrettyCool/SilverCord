# ADR-0001: Assumptions for blank fill-ins

- Status: accepted
- Date: 2026-10-17

## Context

The brief (§0) was pasted with every fill-in blank. The brief requires applying
the defaults, recording them here, and moving on without blocking.

## Decision

| Key | Value used | Notes |
|---|---|---|
| APP_NAME | **SilverCord** | Taken from the repository directory name. Slug `silvercord`, npm scope `@silvercord/*`. Display name, slug, deep-link scheme and app id live in `packages/protocol/src/brand.ts`, so a rename touches that file plus the package scope. |
| APP_SLUG | `silvercord` | Deep links: `silvercord://`. |
| DOMAIN | `localhost` / `*.localhost` | Subdomains planned per §9.2 (`api.`, `gw.`, `cdn.`, `lk.`, `turn.`, `updates.`). Real domain needed before phase 2 deploy (escalation). |
| VPS | 4 vCPU, 8 GB RAM, 1 Gbps, Ubuntu LTS | Capacity math in `docs/spec/voice.md` uses these numbers until real specs are given. |
| GIT_HOST | **GitHub** (`git@github.com:FannyIsPrettyCool/SilverCord.git`) | Supplied by the human after kickoff, overriding the GitLab default. CI is GitHub Actions (`.github/workflows/ci.yml`) and stays thin; all logic lives in `pnpm` scripts. Every completed step is pushed. |
| REGISTRATION | invite-only | First account becomes instance admin and can always register. |
| LANGUAGES | English + French | i18n from day one. |
| LICENSE | Proprietary, all rights reserved | `"license": "UNLICENSED"` in every `package.json`. |
| TARGET_SCALE | ~500 concurrent users | Single process, vertical scaling first; Valkey fan-out keeps horizontal scaling possible. |

Other assumptions taken during phase 0:

- Git author identity is the machine's global git config.
- Development happens on a Linux (Wayland) workstation; Windows builds will need a
  Windows runner (or Wine) later, see `docs/PLATFORM-LIMITS.md`.

## Consequences

- Anything domain-dependent (TLS, TURN, update feed, email links) runs against
  `*.localhost` until the human supplies a domain; that is an escalation trigger
  at the end of phase 2.
- Renaming the product means editing `brand.ts` and running a scope rename across
  `package.json` files.
