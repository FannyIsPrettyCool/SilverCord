# Spec: presence, typing and own read-state synchronization

Phase 2. Presence is ephemeral, never evidence that somebody read a message.
Read states are durable in messaging.md; they are private to the account.

## Presence model and audience

- Postgres `presence_preferences`: PK user_id (user FK CASCADE), `status`
  (`online|idle|dnd|invisible`, default online), `updated_at`. No last-seen/IP or
  activity history. Profile custom status/game detection belongs to Phase 5.
- Valkey leases are keyed by authenticated gateway session id, not user-supplied
  ids. Keep per-user sorted sets of session expiries and a global bounded expiry
  index for sweeping; no keyspace scans. TTL 100 s, refreshed on valid gateway
  heartbeat; remove on detach/revocation/disposal. A detached resumable runtime
  does not keep somebody online. A 5 s sweeper handles crashed processes.
- Effective status is offline if no live attached session, or if preference is
  invisible; otherwise use the explicit preference. Client inactivity may set
  own preference to idle; sending a message never implicitly reveals invisible
  status. Multiple devices share the account preference. DnD suppresses desktop
  sounds/toasts; it does not prevent delivery or own unread badges.
- Phase 2 viewers may see presence only for accepted friends with no block in
  either direction. Sharing a DM/group alone grants no presence access. Phase 3
  adds shared-guild audiences through the same service, with lazy subscriptions.
  Self may always inspect their preference. Disallowed peers get only offline,
  with no distinction between invisible, disconnected and privacy-denied.

`PresenceService.snapshot(viewer, ids)` and audience selection call relationship
services rather than foreign tables. Re-evaluate access on every snapshot and
after relationship changes; do not trust a cached friendship subscription.
Every response contains only requested ids, status and a current observation
timestamp, never login/session counts or heartbeat timings. Disconnect status
is debounced 5 s to avoid flapping; revoke/block/remove visibility immediately.
Valkey outage yields a safe offline snapshot; it does not overwrite a saved
preference or sign users out. Preference mutation still follows the route
limiter's fail-closed behavior.

## Typing model

Valkey `(channel,user,authSession)` marker expires after 8 s; snapshots aggregate
live markers by user. Duplicate active requests refresh expiry at most once per
4 s. Author/session come from request.auth, never request fields.
Do not store text, draft length or keystrokes. Check current channel send access
and block/privacy rules before writing. Disconnect/explicit stop/successful send
clears that session's marker; other active sessions can keep the user typing.
Leave/block clears affected user markers immediately.
Group snapshots exclude users blocked in either direction from the viewer.
Only current members can query a channel's typing set; nonexistent/nonmember
channels both return 404. Do not revive markers on resume. A 1 s bounded expiry
sweep can invalidate active viewers, but clients also expire indicators locally
and refetch instead of keeping an indicator on the strength of a replayed event.

## REST, shared schemas and events

Prefix `/api/v1`; all declare `auth: 'user'`, nonempty `config.rateLimit`, Zod
params/query/body/response/error schemas in protocol `presence.ts`. Reuse
snowflake schemas and UTC timestamps. Token bucket limits are per authenticated
user, capacity/refillPerSecond; the global IP bucket continues to apply.

| Method/path | Input/output | Bucket |
|---|---|---|
| GET `/presence` | comma-separated unique `userIds` (1–100, ≤2,000 bytes) → `{items:[{userId,status,observedAt}]}` | presence.read 60/2 |
| GET `/users/@me/presence` | → own saved preference | presence.read 60/2 |
| PATCH `/users/@me/presence` | `{status}` enum → own preference | presence.write 10/(1/5) |
| PUT `/channels/:channelId/typing` | `{active:boolean}` → 204 | typing.write 5/(1/4) |
| GET `/channels/:channelId/typing` | → `{items:[{userId,expiresAt}]}` (≤9 peers by default) | typing.read 30/2 |

Heartbeats keep their Phase 1 frame shape/rate declaration; server hooks update
leases only after successful identify/resume and acknowledged valid heartbeat.
Clients cannot impersonate a different session or user through these hooks.

Coalesce each source's presence changes over 1 s and typing invalidations per
channel over 1 s; deduplicate recipients. Publish through existing per-user
Valkey buses using `PRESENCE_CHANGED {userId}` and `TYPING_CHANGED {channelId}`.
Payloads are content-free invalidations, so replay cannot expose stale status
or a departed member's typing. No new gateway opcode/per-channel subscription,
durable presence outbox or offline typing replay is required. Recipient selection
is bounded by current friends or channel members; do not publish to the whole
instance. Preference change also invalidates self; successful read-state writes
use the own-session event in messaging.md.

On READY/RESUMED/focus and every 30 s, refetch visible authorized presence;
refetch typing on entering a channel and on invalidation while visible. Indicators
clear on disconnect locally. A stale/missed invalidation must not prolong a
typing marker past expiresAt. No per-frame or one-request-per-member polling.

## Acceptance

1. Integration tests with real Valkey and controlled clocks prove multi-device
   aggregation, graceful disconnect, expired leases, crash recovery, debounce,
   invisible/DnD, coalescing, TTL and bounded key cleanup.
2. Nonfriends/shared-DM-only users cannot infer a status. Block/unfriend racing
   snapshot/event publication leaks no status through replay; unknown ids have
   the same offline projection. Revoked sessions cannot refresh a lease.
3. Every route tests success, validation, auth/access denial and rate limits;
   foreign channel typing, draft spoofing and attempts to keep typing after
   membership removal fail. No lease or draft values appear in logs.
4. Two Electron clients show/clear typing with no extra websocket and no stuck
   indicators after disconnect; own status/read badges converge across devices.
   EN/FR labels and status icons convey meaning without color alone; typing
   announcements are throttled and honor reduced motion.
