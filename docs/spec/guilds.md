# Spec: guilds, channels, roles, invites, moderation, threads, pins

Phase 3; BRIEF §6.4. Authorization per docs/spec/permissions.md; events per ADR-0008/0010.

## Model

- `guilds`: snowflake id, `name` 1–100, `owner_id` (user FK, RESTRICT: transfer first),
  `version`, `created_at`. The `@everyone` role shares the guild id.
- `guild_members`: PK (guild, user), `nickname` 1–32 or null, `joined_at`,
  `timeout_until` or null, `temporary` (joined through a temporary invite; removed when the
  user goes offline while holding no role). Index user_id.
- `roles`: id, guild FK CASCADE, `name` 1–100, `color` 0–0xFFFFFF or null, `icon` (one emoji) or
  null, `permissions` bigint, `position` (unique per guild, deferrable for reorders), `hoist`,
  `mentionable`. Max 100 roles per guild.
  Position 0 belongs only to the role whose id equals its guild id; every other role is
  above 0. Permissions are nonnegative. The migration makes the named position uniqueness
  constraint DEFERRABLE INITIALLY IMMEDIATE; reorders explicitly defer it inside their
  transaction. Drizzle does not express deferrability, so preserve this migration detail.
  Guild creation supplies its owner membership and `@everyone` role atomically in the
  service; the schema permits the intermediate insert order without circular foreign keys.
  Role caps, emoji validity and owner/member lifecycle checks belong to that service.
- `member_roles`: PK (guild, user, role); FK to `guild_members` and `roles` CASCADE; index role.
  Both foreign keys include the guild id, preventing assignment of a role from another guild.
- `channels` gains `guild_id` (CASCADE), `parent_id` (category or, for threads, the parent text
  channel), `position`, `topic` ≤ 1024, `archived` (threads). Types: `guild_text`,
  `guild_voice`, `guild_category`, `announcement`, `thread` besides `dm`/`group_dm`. Index
  `(guild_id, position)` and `parent_id`. Max 500 channels per guild.
- `channel_overwrites`: PK (channel, target_type `role|member`, target_id), `allow`, `deny`
  (channel-scope bits only). Category overwrites are copied into new child channels.
- `invites`: random 10-char base62 `code` PK, guild, channel, `inviter_id` (SET NULL),
  `max_uses` (0 = unlimited, ≤ 100), `uses`, `expires_at` (null = never; default 7 days),
  `temporary`, `created_at`. Index guild_id.
- `guild_bans`: PK (guild, user), `reason` ≤ 512, `banned_by`, `created_at`.
- `audit_log`: id, guild, `actor_id` (SET NULL), `action`, `target_type`, `target_id`,
  `changes` JSON (ids and changed field names/values, never message text), `reason`,
  `created_at`. Index `(guild_id, id DESC)`.
- `pins`: PK (channel, message) with message FK CASCADE, `pinned_by`, `pinned_at`. ≤ 50 per channel.

## Behaviour

- Create guild: creator becomes owner and member; `@everyone` gets the default bits; a
  `general` text channel is created. Users may own at most 25 guilds and join 100.
- Invites: creating needs CREATE_INVITE on the channel. Accepting checks expiry, uses (atomic
  increment), bans, membership caps; already-members just get the guild. Codes are the
  capability: previews show guild name, member count, channel name and inviter card only.
  The desktop registers `silvercord://invite/<code>` and opens a join dialog.
- Roles: create/edit/delete/reorder and assign obey canEditRole/canAssignRole; deleting a role
  removes its overwrites. Hoisted roles group the member list.
- Moderation: kick (KICK_MEMBERS), ban with optional message purge of the last 0–7 days in the
  guild's channels (BAN_MEMBERS), timeout up to 28 days (MODERATE_MEMBERS); all audited with an
  optional reason. Banned users cannot rejoin through invites.
- Threads: created in text/announcement channels (CREATE_THREADS), optionally from a message;
  permissions come from the parent channel, posting needs SEND_MESSAGES_IN_THREADS; the creator
  or MANAGE_THREADS archives/renames. Archived threads are read-only.
- Pins: MANAGE_MESSAGES in guild channels, any member in DMs/groups.
- Messages in guild channels reuse the messaging routes: reading needs VIEW_CHANNEL and
  READ_MESSAGE_HISTORY, sending SEND_MESSAGES (threads: SEND_MESSAGES_IN_THREADS),
  attachments ATTACH_FILES, new reactions ADD_REACTIONS, deleting others' messages
  MANAGE_MESSAGES; `@everyone`/role mentions need MENTION_EVERYONE.
- Every privileged change writes an audit row in the same transaction.
- Channel mutations serialize on the guild row. Reorder supplies every channel exactly once,
  dense zero-based sibling positions and `expectedVersion` from the current guild; a stale
  version returns CONFLICT. Moving channels does not change their overwrites. Creating a child
  copies the category's overwrites. Every channel response masks an inaccessible parent's id.

## Initial management slice

Create/list/view/rename/leave servers and create/list/edit/reorder categories, text, voice and
announcement channels are implemented. Creation supplies owner membership, default role and
`general` atomically, with user-row locks enforcing 25-owned/100-joined caps. Owners cannot
leave. Ownership transfer, deletion, invites, role/overwrite editing, moderation and thread
lifecycle remain separate Phase 3 work. The desktop exposes creation, selection, edits and
leaving; drag reorder is pending. Existing private-message routes explicitly reject guild
channels until fresh guild message/media authorization and channel-scoped fanout are connected.
Voice channel metadata is supported; calls arrive in Phase 4.

## Events

`GUILD_CHANGED {eventId, guildId}` (guild, roles, channels, overwrites, own membership) and
`GUILD_MEMBERS_CHANGED {eventId, guildId}` to all members; a removed member gets
`GUILD_CHANGED` and loses access on refetch (404). Guild channel messages use channel-scoped
outbox rows (ADR-0010). Presence for co-members flows through SUBSCRIBE (ADR-0010).

## Acceptance

1. Permission matrix integration suite over every guild route (with/without the bit, hidden
   channel 404, hierarchy refusals, escalation refusals).
2. Invite flow end to end in the desktop: create, preview, accept (also via deep link), expiry
   and max-use exhaustion, banned user refused.
3. Moderation: kick/ban/timeout effects verified (timed-out member cannot send; banned member
   loses access and cannot rejoin); purge removes recent messages; audit log lists each action.
4. Threads and pins work in guild channels and respect permissions.
