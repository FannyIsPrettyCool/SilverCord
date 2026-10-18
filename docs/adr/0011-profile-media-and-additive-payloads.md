# ADR-0011: Profile media purposes and additive payloads

- Status: accepted
- Date: 2026-10-18
- Scope: Phase 5 profiles and expression (avatars, banners, emotes, stickers, badge icons)

## Context

Phase 2 media belongs to exactly one channel (`media_uploads.channel_id NOT NULL`) and the CDN
authorizes a fetch by channel membership plus a live message attachment. Avatars, banners,
per-server avatars, emotes, stickers and badge icons have no channel: they are shown wherever
their owner, guild or badge appears, including DMs with people the owner has never messaged.

Released 0.2.0 desktops parse every REST response with the protocol's `strictObject` schemas.
Adding a key to an existing response (an `avatar` on `PublicUser`, a `stickers` array on a
message) makes those clients reject the whole payload. Gateway dispatches are safe: clients
ignore unknown event names.

## Decision

1. **Upload purposes.** `media_uploads` gains `purpose` (`attachment | avatar | banner |
   guild_avatar | guild_banner | emote | sticker | badge_icon`), a nullable `guild_id` and a
   nullable `dominant_color`. A CHECK ties scope to purpose: attachments have a channel and no
   guild, guild purposes have a guild and no channel, account and instance purposes have neither.
   The chunk ledger, quota reservation, worker, decoder sandbox and sweep are shared unchanged.
   Profile-class uploads start through `POST /uploads` with the purpose; `complete` accepts an
   optional crop rectangle in source pixels.
2. **Shape per purpose.** The decoder receives the purpose and crop. Profile-class purposes
   never keep a `download` original: they produce a cropped `display`, a `thumbnail` and, for
   animated input, a first-frame `still` (reduced motion, lists at rest). Animated avatars and
   banners are available to every account. Processing also records the dominant colour used
   for banner fallbacks and ambient tinting.
3. **Liveness-based CDN authorization.** A profile-class variant is served only while it is
   referenced: the owner's current avatar or banner, a guild member's current per-server image,
   an existing emote, sticker or badge. Any signed-in session may fetch account, emote, sticker
   and badge images; per-server images need membership in that guild; a banner also needs the
   owner's `banner` audience to include the viewer. Unreferenced ready uploads are visible to
   their owner only (previews). Bearer auth and the separate CDN origin remain mandatory.
4. **Replacement releases.** Setting a new avatar marks the previous upload `deleting` in the
   same transaction; the existing purge path removes objects and releases quota.
5. **Additive payloads only.** Existing response shapes keep their exact keys. Profile data
   reaches clients through new endpoints (`/users/summaries`, `/users/:id/profile`) and new
   dispatch names (`PROFILE_CHANGED`). New optional request fields are allowed. A field may join
   an existing response only after the minimum supported desktop parses it; record that in the
   spec that adds it.

## Consequences

- Avatars and banners need no per-message joins: renderers batch-load summaries by user id
  (like presence) and invalidate on `PROFILE_CHANGED`.
- Emotes used in a DM stay visible to its members after the author leaves the emote's guild,
  until the emote is deleted. Deleting an emote stops delivery on the next fetch.
- Old 0.2.0 desktops keep working against a Phase 5 server; they simply show initials.
