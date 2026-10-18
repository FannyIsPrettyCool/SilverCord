# Spec: private channels and messaging

Phase 2; BRIEF §6.3. Guild channels, pins, search, custom emotes and calls follow
their roadmap phases. Use ADR-0008 and relationships.md; no stack changes.

## Model and invariants

- `channels`: snowflake `id` PK, `type` (`dm|group_dm`), nullable `owner_id` user
  FK (required only for groups), nullable `name` (1–100 characters), `version`,
  nullable `last_message_id`, `created_at`, `updated_at`. Index owner_id for
  ownership/account cleanup. Do not model guild permissions before Phase 3.
- `dm_pairs`: PK `(user_low,user_high)` user FKs, CHECK low < high, UNIQUE
  `channel_id` channel FK. Exactly two immutable memberships; simultaneous opens
  return the same channel. Do not convert a DM into a group: create a new group.
- `channel_members`: PK `(channel_id,user_id)` (channel/user FKs), `joined_at`;
  index `(user_id,channel_id DESC)` lists own channels. Groups have 2–10 members
  by default (max from validated env). A final departing member deletes the
  group; a one-member group may persist after others leave but cannot be created.
- `messages`: snowflake `id` PK, `channel_id` FK, nullable `author_id` user FK
  (`ON DELETE SET NULL`), `content` (max 4,000 Unicode code points, 16 KiB UTF-8),
  nullable `reply_to_id`, `version` (starts 1), `created_at`, nullable `edited_at`.
  Index `(channel_id,id DESC)`, author_id and reply_to_id. Composite FK
  `(channel_id,reply_to_id)` → UNIQUE `(channel_id,id)` enforces same-channel
  replies; migration uses `ON DELETE SET NULL (reply_to_id)` so channel_id stays
  intact. On deletion, replies retain only a missing-reference placeholder.
- `message_idempotency`: PK `(author_id,key)` (UUID v4), `channel_id`,
  `request_hash`, `message_id`, `created_at`; author FK CASCADE. message_id has no
  FK so it retains the deleted id, without text. Retain keys until account
  deletion; never restore a deleted message on retry. Index message_id for cleanup.
- `message_reactions`: PK `(message_id,user_id,emoji)` (message/user FKs),
  `created_at`; index user_id for account deletion. Max 20 distinct emoji per
  message, 20 reactions per actor/message; duplicate add/remove is a no-op.
- `message_mentions`: PK `(message_id,user_id)` (FKs), index `(user_id,message_id)`.
  Extract server-side only from recognized AST mention nodes for current members;
  code/escaped text cannot mention. Role/everyone mentions are unavailable in DMs.
- `read_states`: PK `(user_id,channel_id)` (user/channel FKs), nullable
  `last_read_message_id`, `updated_at`; index channel_id for deletion. Message
  deletion does not erase the high-water mark; numeric snowflake bounds remain
  valid. Media owns attachment rows/authorization (media.md).
- Channel deletion cascades its message/mention/reaction/read/attachment rows;
  enqueue object deletion through media service. No deleted text/edit-history
  copies, attachment URLs or embed bodies remain in DB or event outbox.

## Access and concurrent changes

`ChannelsService` owns membership checks and recipient selection; MessagesService
uses it instead of reading channel tables. Every read, write, download and reply
fetch rechecks current membership. Unknown and nonmember resources both return
404. Instance admin is not a private-message bypass.

DM open/send requires the recipient's current privacy policy and no block in
either direction. Block prevents both directions; an idempotent retry also
rechecks access before returning anything. Existing DM history remains readable.
For the viewer's own blocks, replace blocked authors' messages with
`{id,channelId,hidden:true}` and exclude their text, author card, attachments,
reactions, reply excerpts and mention/unread counts. Omit blocked actors from
reaction summaries on other messages too. No reveal-content endpoint
in Phase 2. Other members retain their ordinary view. Shared groups can continue
talking after a block; block neither ejects peers nor prevents their messages to
other members. New group membership rejects a block in either direction with
any current member. Any member may invite their accepted friends; only owner may
rename or remove others, and anyone may leave. Owner leave transfers ownership
to the remaining member with the smallest user id. Added members can read full
group history; the invite UI explicitly says so before adding them.

Use short Postgres transactions: lock involved social_privacy rows ascending,
then channel, then message, then media upload rows ascending. Group membership
changes snapshot the roster, lock social rows for roster plus additions, lock
channel, and restart if roster/version changed; never acquire new social locks
after a channel lock. Message sends in groups only need channel/message/media
locks because existing blocks do not deny group sends. DM sends lock both social
rows first. Check membership/privacy again under locks. Removal versus send has
a single commit order; a removed member never reads a later message. Allocate
message id after channel lock, require it greater than last_message_id (fail
safely on clock regression), and commit messages, channel version and outbox
together. No external network calls inside these transactions.

## REST and protocol

Prefix `/api/v1`; all routes declare `auth: 'user'`, strict Zod schemas and error
responses, and nonempty rate rules. Protocol exports channels/messages/public
user views, discriminated visible/hidden message schemas, reaction summaries,
read-state schemas and events. Peer DTOs never include CurrentUser/private notes.
Limits are token-bucket capacity/refillPerSecond per authenticated user; global
IP limiting remains. Shared named buckets cover all methods in each family.

| Method/path | Contract | Bucket |
|---|---|---|
| GET `/users/@me/channels` | existing cursor query → `{items,nextBefore}` by channel id DESC, includes own unread/mention counts | chat.read 120/4 |
| POST `/users/@me/channels` | `{recipientId}` DM, or `{recipientIds: unique ids[1..9],name?}` group; caller excluded → Channel (200) | channel.open 10/(10/60) |
| GET `/channels/:channelId` | → Channel with public member cards, own read state/counts | chat.read |
| PATCH `/channels/:channelId` | `{name,expectedVersion}` → Channel, 409 on stale version | channel.write 20/1 |
| PUT `/channels/:channelId/members/:userId` | empty body; invite friend → 204 | channel.write |
| DELETE `/channels/:channelId/members/:userId` | leave or owner removal → 204 | channel.write |
| GET `/channels/:channelId/messages` | existing cursor query → `{items,nextBefore,nextAfter}` | chat.read |
| GET `/channels/:channelId/messages/:messageId` | → visible message or blocked placeholder | chat.read |
| POST `/channels/:channelId/messages` | required `Idempotency-Key` UUID v4; `{content,replyToId?,attachmentIds?: unique ids[0..10]}` → Message (200) | message.send 10/2 |
| PATCH `/channels/:channelId/messages/:messageId` | author only `{content,expectedVersion}` → Message, increments version; 409 if stale | message.write 20/2 |
| DELETE `/channels/:channelId/messages/:messageId` | author only → 204, repeated deletion by same author → 204 | message.write |
| PUT, DELETE `/channels/:channelId/messages/:messageId/reactions/:emoji` | one canonical Unicode emoji sequence, URI encoded; → 204 | reaction.write 20/2 |
| PUT `/channels/:channelId/read-state` | `{messageId}` → own ReadState; monotonic maximum | read.write 30/2 |

Empty content is allowed only with ready attachments. Do not normalize markdown
or passwords alike: preserve message whitespace and reject NUL/invalid Unicode.
Canonical parsed create body (including ordered attachment ids and nullable
reply) plus channel id is SHA-256 hashed for idempotency. Insert key and message
in one transaction. Same key/hash returns the existing message without events,
counts or attachment changes; mismatch → 409. Deleted message retry → 404. A
reply target must be visible in this channel; no cross-channel excerpts.
Delete after membership loss returns 404; repeated-delete authorship can be
checked against own idempotency rows, without retaining content tombstones.

Pagination reuses `cursorPageQuerySchema`: 50 default, 100 max, exclusive id
bounds; before and after cannot coexist. Before/default selects newest matches;
after selects nearest newer matches; serialize every page DESC. Bound output
using limit+1, expose continuation only if more exists. Message bodies are
authorized/redacted in one bounded query path; no per-item user/attachment N+1.
Fetch single message for jump-to, then before/after it. Read-state target must
exist in this channel and be visible; never accept guessed foreign ids or values
beyond channel high-water mark. Counts ignore own/hidden messages; own read
states synchronize across devices, and peers receive no read receipts in v1.

## Events, rendering and acceptance

Outbox to current member user buses: `CHANNEL_CHANGED {eventId,channelId}`,
`MESSAGE_CHANGED {eventId,channelId,messageId}`, and `READ_STATE_CHANGED
{eventId,channelId}` (own sessions only). Leaving/removal also invalidates the
departing user's channel cache. Deleted message GET returns 404 and evicts it.
No text or member roster enters replay. Reconcile using ADR-0008.

`packages/markdown` returns bounded AST, never HTML. Phase 2 supports bold,
italic, underline, strike, inline/fenced code, quote, spoiler, lists, headings,
http(s) links, masked links, timestamps, and user mentions. Escape raw HTML;
reject unsafe link schemes, limit nesting/tokens, and never fetch linked images
or unfurls directly. External links use the existing validated main-process
opener. Inline rich previews remain absent until the SSRF-safe worker exists.
Tiptap serializes the same subset; per-channel drafts are local, separate by
account, cleared on sign-out. Optimistic sends keep one UUID through retries;
no auto-retry on 403/404, and pending bubbles reconcile with HTTP results.

1. Integration tests cover every route's success/validation/auth/access/rate
   paths, foreign replies/attachments, stale edits, group cap and owner transfer.
2. Concurrent duplicate sends create one row/event; block/remove versus send,
   invite versus leave, delete versus edit and read regression obey invariants.
3. Crash after DB commit/before PUBLISH recovers; duplicate/missed invalidations,
   resume and removed-member replay recover without exposing private content.
4. Two Electron clients request/accept → open DM → send/reply/edit/delete/react;
   disconnect/retry never duplicates a bubble. Own read badges converge.
5. Virtual list anchors through prepend/deletion/image sizing, jump-to works,
   and 10k seeded messages scroll at 60 fps on recorded hardware (docs/PERF.md).
   Cozy/compact/bubble, EN/FR, keyboard navigation, labels and reduced motion
   pass the real-app screenshot/accessibility loop before marking Phase 2 done.
