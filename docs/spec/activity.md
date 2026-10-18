# Spec: activity

Phase 5; BRIEF §6.7. Four sources, each off until the user turns it on, enforced by the server.
Shown under the `activity` audience (`profiles.md`) and only while the viewer sees the owner as
online (never reveals an invisible user).

## Activity object (protocol `activity.ts`)

`type` (`playing|listening|watching|streaming|competing`), `name` 1–128, `details` and `state`
≤ 128 or null, `startedAt`/`endsAt` (ISO, endsAt after startedAt, both within a week of now) or
null, `buttons` ≤ 2 of `{label ≤ 32, url https only ≤ 512}` (RPC only), `application` (RPC
client name ≤ 64) or null. Text is plain (no markdown); control/format characters rejected.
The server adds `source` (`manual|game|rpc|media`) when reading.

## Storage and lifetime

- Settings: `user_profiles.activity_sources` `{manual, game, rpc, media}` booleans (default all
  false). Turning a source off clears its stored activity at once.
- Manual: `user_profiles.manual_activity` JSONB + `manual_activity_expires_at` (like custom
  status; minute sweep). Survives reconnects.
- Detected (game, rpc, media): Valkey hash `activity:<userId>`, field `<source>:<authSessionId>`,
  value `{activity, at}`; the desktop re-sends every 60 s while the activity lasts; entries older
  than 150 s are ignored and pruned. Several devices: the newest entry per source wins. Signing
  out a session drops its entries on the next read. No history is kept.
- Reading order: rpc, game, media, manual (`activities[0]` is the primary one; ≤ 4).

## REST

| Method/path | Contract | Bucket |
|---|---|---|
| GET `/users/@me/activity` | `{sources, manual, activities}` | activity.read 60/2 |
| PUT `/users/@me/activity/sources` | `{manual, game, rpc, media}` → own activity | activity.write 20/(1/3) |
| PUT `/users/@me/activity/:source` | `{activity, expiresAt?}` (manual only) → 204; 403 when the source is off | activity.write |
| DELETE `/users/@me/activity/:source` | → 204 | activity.write |

Summaries gain `activity` (primary) and profiles `activities` under the audience/online rules.
Changes publish `PROFILE_CHANGED` (coalesced per user). Repeated identical heartbeats do not.

## Desktop sources (main process, opt-in)

- **Game detection**: every 15 s list process image names (Windows `tasklist /fo csv /nh`, Linux
  `/proc/*/comm` + `exe` basename). Match a bundled allowlist (`resources/games.json`,
  executable → name) plus the user's own list in `userData/activity-games.json` (≤ 100 entries,
  edited in Settings › Activity). Nothing else about processes leaves the machine.
- **Local RPC**: `docs/rpc.md`. Apps must be approved once by the user; denied apps are ignored.
- **Media session**: Windows SMTC through a long-lived PowerShell WinRT reader; Linux MPRIS
  through `playerctl` (or `gdbus` when absent). Reports title/artist/player as `listening`
  (or `watching` for video players); paused media clears it.
- The renderer polls `activity:snapshot` every 5 s and forwards changes; main never talks to the
  API for activity. Every IPC input is validated and sender-checked.

## Acceptance

1. Integration: disabled sources are refused (403) and cleared; invisible/offline owners leak no
   activity; stale detected entries disappear; audience applies to summaries and profiles.
2. Unit: process matching, RPC framing/limits/validation, SMTC/MPRIS parsing.
3. Real app: manual activity and an RPC client (example in `docs/rpc.md`) show on the card.
