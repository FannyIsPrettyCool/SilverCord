# Spec: relationships and social privacy

Phase 2; BRIEF §6.2. Contracts precede implementation. IDs use the existing
snowflake schema; times are UTC ISO strings. See ADR-0008 for event delivery.

## Goal and model

- `relationship_pairs`: `id` unique snowflake, `user_low`, `user_high` (user FKs),
  `state` (`none|pending|friends`), nullable `requested_by`, `version` integer,
  `created_at`, `updated_at`. PK `(user_low,user_high)`; CHECK low < high and
  requested_by is one endpoint iff pending. Index `(user_low,id DESC)` and
  `(user_high,id DESC)` for each user's list. A removed pair retains only its
  identity/state/version; notes and blocks are separate directed records.
- `user_blocks`: `id` snowflake PK, `owner_id`, `target_id` (user FKs), `created_at`;
  UNIQUE `(owner_id,target_id)`, CHECK different users, index `(target_id,owner_id)`
  for reverse denial checks and `(owner_id,id DESC)` for listing.
- `relationship_metadata`: PK `(owner_id,target_id)` (user FKs), nullable private
  `nickname` (1–32 trimmed characters), `note` (0–1,000 characters), `updated_at`;
  index `target_id` for account deletion. Only owner can read/write either field.
- `social_privacy`: PK `user_id` (user FK), `friend_requests` (`everyone|nobody`,
  default everyone), `direct_messages` (`friends|nobody`, default friends),
  `version`. Create/backfill one row per user; this is also a stable lock target.
  Future shared-guild privacy choices wait for guild membership in Phase 3.
- All user FKs cascade on account deletion. Cross-module user lookup goes through
  `UsersService`; add a public-card projection `{id,username,displayName}`.
  Never serialize `CurrentUser` to peers: it includes email and account flags.

## State, privacy and races

Services expose `request`, `accept`, `remove`, `block`, `unblock`, `canDirectMessage`
and `canSeePresence`; they accept an Executor for callers composing transactions.
Lock involved social_privacy rows by ascending user id before pair/block writes;
lock channel rows after social rows and message/media rows after channels.
Never read a block/privacy decision outside the transaction that uses it.

Request resolves an exact normalized username using the existing username schema.
Self, missing user, disabled requests, either-direction block and unavailable
accounts return the same 404 `NOT_FOUND` envelope. Do not offer user enumeration
or prefix search. A duplicate outgoing request or existing friendship is a no-op;
a crossing request returns the existing incoming state and still needs accept.
Only the requested recipient may accept pending; otherwise 404. Accept checks
blocks again. Remove deletes pending/friend state for either party, idempotently.
Blocking removes either pending/friend state in the same transaction; unblocking
does not restore it. Only the blocker sees a block record; the other party gets
an ordinary relationship invalidation, with no block reason or private fields.

Any block forbids new DM creation, DM sends, typing and future calls both ways.
Existing DM history stays readable to its two members, with blocked authors'
content hidden to the blocker as specified in messaging.md. Existing shared
group membership is preserved; groups never bypass block filtering or permit
inviting a new member blocked by any existing member. Unfriend/privacy changes
stop subsequent DM sends when the recipient no longer allows them.

## REST and shared Zod contracts

All paths below are under `/api/v1`; each declares `config.auth: 'user'`, response,
params/body/query schemas, error responses and nonempty `config.rateLimit`.
The existing global IP bucket remains. Policies below are token bucket
`capacity/refillPerSecond`, per authenticated user, shared by route family.

| Method/path | Input and output | Bucket |
|---|---|---|
| GET `/users/@me/relationships` | `kind=friends|incoming|outgoing|blocked` + existing cursor query; `{items,nextBefore}` ordered id DESC | social.read 60/2 |
| POST `/users/@me/relationships` | `{username}` → caller's relationship view (200) | social.request 10/(10/3600) |
| PUT `/users/@me/relationships/:userId/accept` | empty body → caller's view (200) | social.write 20/1 |
| DELETE `/users/@me/relationships/:userId` | remove/decline/cancel → 204 | social.write 20/1 |
| PUT, DELETE `/users/@me/blocks/:userId` | block/unblock → 204 | social.write 20/1 |
| PUT `/users/@me/relationships/:userId/metadata` | `{nickname: string|null,note: string|null}` → own metadata | social.write 20/1 |
| GET, PATCH `/users/@me/privacy` | patch either privacy enum → complete own privacy object | social.read or social.write |

`relationships.ts` exports strict input schemas, own relationship views (id,
public user, kind, version, own metadata), privacy schemas, and paginated results.
List limits reuse `cursorPageQuerySchema` (50 default, 100 max, exclusive bounds,
before/after mutually exclusive); after queries return the nearest newer ids,
serialized DESC. Block lists expose only caller-owned blocks. Metadata requires
a known relationship or shared channel; otherwise 404. Mutual-friends views wait
for a privacy-reviewed public profile endpoint, not an unrestricted graph API.

## Events and acceptance

Outbox `RELATIONSHIPS_CHANGED {eventId}` goes to affected users; metadata/privacy
changes invalidate only the owner. Blocking also invalidates the blocker's cached
channels/messages; presence audiences reconcile immediately. No peer receives
another person's metadata/privacy settings. Refetch on reconnect (ADR-0008).

1. Two clients request/accept and receive only their own relationship view.
2. Duplicate/crossing requests, accept versus cancel/block, block versus send,
   and simultaneous privacy changes preserve the state rules in real Postgres.
3. No email, block reason, note or nickname appears in another account's REST,
   gateway, error response or logs. Guessed ids cannot modify another owner's data.
4. Every route has success, validation, auth/access denial and rate-limit tests;
   stale caches are cleared after block; EN/FR forms are keyboard accessible.
5. All FK/query indexes are present in the reviewed forward migration.
