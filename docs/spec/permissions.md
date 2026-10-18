# Spec: permission engine and guild authorization

Phase 3; BRIEF §5.4. `packages/permissions` is pure and dependency-free; the server is
authoritative, the client uses it for UI hints only.

## Bits

64-bit `bigint` bitfield, serialized as a decimal string on the wire. Bit positions are part of
the stored data: append only, never reuse.

| Bit | Name | Scope | Meaning |
|---|---|---|---|
| 0 | VIEW_CHANNEL | channel | see the channel and its messages |
| 1 | SEND_MESSAGES | channel | post messages |
| 2 | SEND_MESSAGES_IN_THREADS | channel | post in threads |
| 3 | CREATE_THREADS | channel | start threads |
| 4 | EMBED_LINKS | channel | link previews (when unfurls exist) |
| 5 | ATTACH_FILES | channel | attachments |
| 6 | ADD_REACTIONS | channel | add new reactions |
| 7 | USE_EXTERNAL_EMOJIS | channel | other servers' emotes (phase 5) |
| 8 | MENTION_EVERYONE | channel | `@everyone`, `@here`, any role mention |
| 9 | READ_MESSAGE_HISTORY | channel | read messages sent before joining the view |
| 10 | MANAGE_MESSAGES | channel | delete others' messages, pin |
| 11 | MANAGE_THREADS | channel | archive/rename/delete threads |
| 12 | CONNECT | channel | join voice (phase 4) |
| 13 | SPEAK | channel | |
| 14 | VIDEO | channel | |
| 15 | STREAM | channel | |
| 16 | USE_VAD | channel | |
| 17 | PRIORITY_SPEAKER | channel | |
| 18 | MUTE_MEMBERS | channel | |
| 19 | DEAFEN_MEMBERS | channel | |
| 20 | MOVE_MEMBERS | channel | |
| 21 | CREATE_INVITE | channel | |
| 22 | CHANGE_NICKNAME | guild | own nickname |
| 23 | MANAGE_NICKNAMES | guild | others' nicknames |
| 24 | KICK_MEMBERS | guild | |
| 25 | BAN_MEMBERS | guild | |
| 26 | MODERATE_MEMBERS | guild | timeouts |
| 27 | MANAGE_CHANNELS | channel | create/edit/delete/reorder channels |
| 28 | MANAGE_ROLES | channel | roles; on a channel: its overwrites |
| 29 | MANAGE_EMOJIS | guild | (phase 5) |
| 30 | VIEW_AUDIT_LOG | guild | |
| 31 | MANAGE_GUILD | guild | name, settings, invites of others |
| 32 | ADMINISTRATOR | guild | everything, bypasses overwrites |

Default `@everyone`: VIEW_CHANNEL, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, CREATE_THREADS,
EMBED_LINKS, ATTACH_FILES, ADD_REACTIONS, USE_EXTERNAL_EMOJIS, READ_MESSAGE_HISTORY, CONNECT,
SPEAK, VIDEO, STREAM, USE_VAD, CREATE_INVITE, CHANGE_NICKNAME.

## Resolution (`computeGuildPermissions`, `computeChannelPermissions`)

1. Owner → all bits.
2. Base = `@everyone` role ∪ every role of the member. ADMINISTRATOR in base → all bits.
3. Channel: apply the `@everyone` overwrite (`(p & ~deny) | allow`), then all of the member's role
   overwrites aggregated (OR of their denies, then OR of their allows), then the member overwrite.
   Category overwrites do not cascade; creating a channel in a category copies them (synced).
4. Implicit rules, in order: without VIEW_CHANNEL the result is 0; without SEND_MESSAGES the
   send-dependent bits (MENTION_EVERYONE, ATTACH_FILES, EMBED_LINKS) are cleared; in a voice
   channel without CONNECT the voice bits (SPEAK…MOVE_MEMBERS) are cleared; a timed-out member
   keeps only VIEW_CHANNEL and READ_MESSAGE_HISTORY. Guild-scope bits never appear in a channel
   result (`CHANNEL_SCOPE` mask). Owners and administrators bypass timeout masks; the moderation
   action guard refuses to apply a timeout to either, including when the actor is the owner.
   Remove the target's administrator role first if a timeout is required.

## Hierarchy (`canManageRole`, `canActOn`, `canEditRole`, `canEditOverwrite`)

Roles have a unique position per guild (`@everyone` is 0). A member's rank is their highest
role position; the owner outranks everyone.

- Manage a role: MANAGE_ROLES (or admin/owner) and role position < actor rank; never `@everyone`
  deletion or reordering.
- Act on a member (kick, ban, timeout, nickname, role assignment): the required bit, target is
  not the owner, not the actor (except own nickname), and target rank < actor rank.
- No escalation: a non-owner may only set allow bits it holds itself (guild base for roles,
  channel result for overwrites), may not grant ADMINISTRATOR unless it is the owner, and may
  not move a role to or above its own rank.
- `canAssignRole` also refuses an existing ADMINISTRATOR role for every non-owner, including
  another administrator. Administrator-role assignment changes are reserved for the owner.
- `canEditOverwrite(guild, actor, currentChannel, target, replacement)` receives the complete
  current channel and a role/member target. `replacement` is `{allow, deny}` or `null` to delete
  that overwrite. The service must supply fresh, locked state; validate that member targets
  belong to the guild. Role targets must be `@everyone` or a role of this guild.
- Overwrite authorization computes the actor's current channel permissions itself. For a
  non-owner it requires MANAGE_ROLES, compares old and new masks, and permits changing only bits
  the actor currently holds. Removing a deny and deleting an overwrite count as changes;
  preserving an existing deny does not require holding its denied bit. It then computes the
  proposed complete channel and rejects any growth in the actor's effective permissions.
  This applies to everyone, role and member targets, including the actor's own overwrites.
  New masks contain only CHANNEL_SCOPE bits, including for owners. Overwrite rows are unique
  by `(channel, target_type, target_id)`; partial or stale snapshots cannot authorize writes.

## Server enforcement

- Every route declares `config.permission`: `{ scope: 'none', reason }` for routes outside
  guilds, or `{ scope: 'guild' | 'channel', bits, param }`. Route registration fails without it
  (same mechanism as `rateLimit`/`auth`), and the route sweep test asserts it from OpenAPI.
- Declared guild/channel bits are checked in a preHandler after authentication, before the
  handler, using fresh database state; failures return 404 when the caller cannot view the
  resource and 403 otherwise. Services re-check hierarchy and escalation rules in the same
  transaction as the write (row locks on `guilds` then `guild_members`).
- Gateway subscriptions (member list ranges) call the same engine.
- The route guard is installed before route registration. `BuildOptions.permissionChecker`
  supplies the authoritative guild/channel reader; an unavailable checker denies scoped
  requests. The guard does not cache its result. CORS has one explicit synthetic preflight
  exemption; each existing account/private-message route declares its own non-guild reason.
  OpenAPI exposes JSON-safe `x-permission` metadata for the route coverage sweep.
- A zero-bit guild requirement still requires current membership (for viewing the server itself
  or leaving it, even with no visible channels). A zero-bit channel requirement still requires
  channel visibility. The default app checker reads current roles/membership/bans/timeouts from
  PostgreSQL; role/overwrite reads share a repeatable-read snapshot. Writes first lock the guild
  row and recheck authorization inside their transaction. The channel sidebar resolves all
  channels in a bounded number of queries rather than querying roles for each channel.
- DM and group channels keep membership-based access (messaging.md) and map to a fixed DM
  permission set; ChannelsService exposes `access(channelId, userId) → bits` for both.

## Acceptance

1. fast-check properties: monotonicity (roles and allows never remove, denies never add),
   overwrite precedence (member > roles > everyone), admin/owner bypass, implicit view rule,
   hierarchy (cannot manage equal/higher roles), no escalation through any sequence of permitted
   role edits, assignment or overwrite edit. The role model applies accepted positions exactly,
   including insertion/reorder shifts; non-admin scenarios are generated explicitly. Overwrite
   sequences include replacement and deletion for everyone, actor roles, self and other members.
   Regressions cover removal of an unheld deny, owner-only administrator delegation, and refusal
   of administrator/owner timeout targets.
2. Permission matrix integration suite: for every guild route, a member without the bit is
   refused and one with it succeeds; hidden channels are 404.
3. A route registered without `config.permission` fails app construction (unit test) and the
   OpenAPI sweep covers every route.
