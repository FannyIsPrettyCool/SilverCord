# ADR-0010: Guild event fan-out and lazy member presence

- Status: accepted
- Date: 2026-10-18
- Scope: Phase 3 guilds, ~500 concurrent users, one API process

## Context

ADR-0008 writes one outbox row per recipient. In a guild text channel every message would then
insert a row per member allowed to view the channel (hundreds), inside the send transaction.
Presence must reach users sharing a guild (BRIEF §5.3), but pushing every co-member's status to
every client is the wholesale fan-out the brief rules out ("subscribed per visible range").

## Decision

1. **Scoped outbox rows.** `event_outbox` gains a nullable `scope_channel_id`; a row has either a
   recipient or a channel scope (CHECK). Guild channel message, typing-free invalidations are
   written once per event with the channel scope. The dispatcher resolves recipients at publish
   time through `ChannelsService.viewers(channelId)` (guild members whose channel permissions
   include VIEW_CHANNEL, evaluated with the permission engine on fresh rows) and publishes to
   each user bus. Recipients who lost access in between get nothing; new viewers reconcile through
   REST. Guild-wide administrative events (`GUILD_CHANGED`, `GUILD_MEMBERS_CHANGED`) stay
   per-recipient rows: they are rare.
2. **Lazy guild presence.** Presence is visible to friends and to users sharing a guild. The
   gateway's `SUBSCRIBE` op (`{ guildId | null }`) attaches the session to
   `gw:guild-presence:<guildId>` after a membership check; a new SUBSCRIBE replaces it and a
   disconnect drops it. Coalesced presence changes are published once per guild channel, not
   per member. The member list itself is paged over REST (`/guilds/:id/members?after=&limit=`)
   as the virtualized list scrolls, and statuses for the visible range come from
   `GET /presence`, so the subscription is per viewed guild and the data per visible range.

## Consequences

- Message sends in large guilds cost one outbox row; fan-out work moves to the dispatcher.
- A presence event names only a user id; receivers refetch authorized statuses, so a session
  subscribed to a guild learns nothing it could not already query.
- Multi-process deployments keep working: both mechanisms ride on Valkey pub/sub.
