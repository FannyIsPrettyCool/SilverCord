# ADR-0008: Private messaging delivery and reconciliation

- Status: accepted
- Date: 2026-10-18
- Scope: Phase 2; one API/gateway process, about 500 concurrent users

## Context

ADR-0006 runtimes already subscribe to `gw:user:<id>` and retain serialized events
for disconnected clients. Removing group membership must stop subsequent content
access, including through replay. Postgres commits and Valkey publication cannot
be atomic. A successful message send must survive an API crash or Valkey outage.

## Options

1. Publish full messages after commit: least code, but a crash loses notifications
   and replay may disclose text after membership changes.
2. Add a transactional outbox and publish small invalidations to existing user
   buses; clients fetch authorized REST resources and reconcile periodically.
   Extra REST requests and duplicate notifications are the cost.
3. Replace the gateway with durable per-user streams and permission-aware replay:
   stronger synchronization, but changes ADR-0006 and adds consumer lifecycle work
   before the first DM can ship.

## Decision

Use option 2. Transactions write domain state and recipient outbox rows together.
`event_outbox` has `id` (snowflake PK), `recipient_user_id` (FK CASCADE, indexed), `type`,
validated `payload` (JSONB), `created_at`, `available_at`, `attempts`, `published_at`.
Index pending rows on `(available_at, id) WHERE published_at IS NULL`; index
`published_at` for cleanup. An API-owned dispatcher runs on startup and every
250 ms, processes bounded batches of 100, retries with capped exponential backoff,
and publishes through the existing `EventPublisher` to `channels.user(recipient)`.
One dispatcher per API process in v1; never mark a row published before PUBLISH
returns. Failure after publishing can produce duplicates. Purge published rows
after 24 hours; retain pending rows and alert on oldest pending age over 60 s.
Log identifiers and queue age, never message text or private relationship fields.

Durable events carry `{ eventId, ...resourceIds }`, never message bodies, file
URLs, private notes, member rosters, presence values or actor IPs. Event schemas
live in `packages/protocol`; the runtime still assigns its own transport sequence.
The recipient may have lost access before delivery: REST rechecks current access,
and a 404 evicts the cached resource. Clients deduplicate by eventId and compare
resource versions; an old invalidation may trigger a harmless refetch.

Pub/sub acknowledgment does not prove a runtime received anything. On READY,
RESUMED, reconnect, window focus, and every 30 s while connected, reconcile the
channel list, relationships, own read states and the newest page of the visible
channel. Refetch the visible channel on each invalidation; close any pagination
gap through REST before marking it read. Resume retains its five-minute limit;
it does not become a durable message queue. Typing/presence use transient
content-free invalidations, a fresh authorized snapshot, and expiry, not outbox.

Private media uses immutable content-addressed objects behind authenticated CDN
authorization on every request. Browser responses are `private, no-store`; only
the private storage/cache can reuse immutable bytes. This narrows BRIEF §5.6's
immutable caching policy so removed members cannot reuse a public CDN URL.
Already downloaded content cannot be revoked from another person's device.

## Consequences and evidence

- No new per-channel subscriptions or gateway opcodes are needed in Phase 2.
- Cross-module transaction helpers accept the existing `Executor`; modules expose
  services for access and recipient selection instead of reading foreign tables.
- Concurrent permission changes and writes use the lock order in the feature
  specs; tests must prove denied users cannot fetch queued/replayed content.
- [Valkey pub/sub](https://valkey.io/topics/pubsub/) is at-most-once, so REST
  reconciliation remains required even with the outbox (checked 2026-10-18).
- [Postgres row locking](https://www.postgresql.org/docs/18/explicit-locking.html)
  supports transaction-held locks; all writers must acquire them consistently
  (checked 2026-10-18). No stack change or additional broker is introduced.
