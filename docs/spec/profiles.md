# Spec: profiles, custom status and per-server profiles

Phase 5; BRIEF §6.7. Media per ADR-0011; badges in `badges.md`; activity in `activity.md`;
emotes/stickers/pickers in `expressions.md`. Presence audience rules from `presence.md` apply.

## Model

- `user_profiles` (PK user_id, user FK CASCADE; a missing row means all defaults):
  - `bio` ≤ 400 code points and ≤ 12 lines, chat-markdown profile subset (below) or null.
  - `pronouns` ≤ 40 code points, no control/format characters, or null.
  - `accent_color`, `banner_color`: 0–0xFFFFFF or null (null: derived from the avatar's
    dominant colour, then the theme accent).
  - `theme_primary`, `theme_secondary`: 0–0xFFFFFF or null, both or neither (profile gradient).
  - `avatar_upload_id`, `banner_upload_id`: media FK SET NULL; purpose must match (service).
  - `custom_status_text` ≤ 128, `custom_status_emoji` (one unicode emoji or `custom:<emoteId>`),
    `custom_status_expires_at` or null; text or emoji required when set.
  - `privacy` JSONB audience map (below), validated by Zod on write, defaults merged on read.
  - `updated_at`, `version` (optimistic concurrency for the editor; mismatch → 409).
- `guild_member_profiles` (PK guild+user, FK `guild_members` CASCADE): `avatar_upload_id`,
  `banner_upload_id`, `bio`, `pronouns`, `accent_color`. Nickname stays on `guild_members`.
  A null column inherits the global value. Leaving the guild deletes the row and its media.
- `user_notes` (PK owner+target, both user FK CASCADE): private note ≤ 256 code points about
  another user, visible only to its owner.
- Display name stays on `users` (1–32, existing rules) and is edited through the profile route.

## Privacy audiences (server-enforced)

Audience values, from widest to narrowest: `everyone` (any signed-in user), `mutual_guilds`
(friends and people sharing at least one guild), `friends` (accepted friends), `only_me`.
Each section has one audience: `bio`, `pronouns`, `banner`, `badges`, `member_since`,
`custom_status`, `activity`, `mutual_friends`, `mutual_guilds`. Defaults: `everyone` except
`activity`, `mutual_friends` and `mutual_guilds` (`mutual_guilds`).

- The owner always sees everything. A block in either direction reduces the viewer to the
  identity core: username, display name, avatar, accent and banner colour.
- `custom_status` and `activity` are also hidden whenever the viewer's effective presence of
  the owner is offline (invisible, disconnected or presence-denied), so they cannot reveal an
  invisible user.
- Hidden sections are omitted from responses (absent key), never sent as "hidden" markers, so a
  viewer cannot distinguish "not set" from "not shared".
- Mutual lists contain only ids both sides can already see: mutual friends are accepted friends
  of both; mutual guilds are guilds both are members of. Capped at 100 each with a total count.
- The per-server profile in guild context is visible to that guild's members only; outside the
  guild the global profile is shown.

## Profile markdown subset

Parsed with `@silvercord/markdown`; renderers drop headings to paragraphs and code blocks to
inline code. Allowed: emphasis, underline, strike, spoiler, inline code, links (rendered as
external links validated by the existing opener), user mentions (rendered as names), timestamps,
quotes, lists, line breaks, unicode and custom emotes. No images, no embeds.

## REST

Prefix `/api/v1`, `auth: 'user'`, Zod contracts in protocol `profiles.ts`. Lookup of an unknown
user is 404. Buckets are per user, capacity/refillPerSecond.

| Method/path | Contract | Bucket |
|---|---|---|
| GET `/users/@me/profile` | own editable profile incl. privacy, version | profile.read 60/2 |
| PATCH `/users/@me/profile` | partial fields + `version` → own profile | profile.write 10/(1/3) |
| PUT `/users/@me/profile/privacy` | full audience map → own profile | profile.write |
| PUT `/users/@me/custom-status` | `{text,emoji,expiresAt}` → 204; DELETE clears | status.write 10/(1/5) |
| GET `/users/:userId/profile` | `?guildId=` optional → viewer-filtered profile | profile.read 30/1 |
| GET `/users/summaries` | `userIds` 1–100, `guildId` optional → card summaries | summaries.read 60/2 |
| GET/PUT `/users/:userId/note` | `{note}` (empty clears) | profile.read / profile.write |
| GET/PATCH `/guilds/:guildId/members/@me/profile` | member overrides + nickname | profile.read / profile.write |

- Summary item: `userId`, `avatar` (variant paths, animated, dominant colour) or null,
  `accentColor`, `customStatus` (audience + presence filtered) and `activity` (primary entry,
  filtered). With `guildId`, the caller must be a member; members get `nickname` and per-server
  avatar overrides. Non-members of a guild are reported with global data only.
- Full profile adds `bio`, `pronouns`, `banner`, `bannerColor`, `themeColors`, `badges`
  (pinned first), `memberSince`, `mutualFriends {count, ids}`, `mutualGuilds {count, ids}`,
  `relationship` (none, friend, incoming, outgoing, blocked), `note` (own note) and, in guild
  context, `guildMember {nickname, joinedAt, roleIds}`.
- Setting `avatarUploadId`/`bannerUploadId` requires an owned `ready` upload of the matching
  purpose; it becomes `attached` and the previous one is released in the same transaction.
- Per-server nickname needs CHANGE_NICKNAME; per-server images and bio need guild membership.
- Expired custom statuses read as absent; a minute sweep clears expired rows and notifies.

## Events

`PROFILE_CHANGED {userId}` is transient (presence-style): coalesced over 1 s per user and
published to the same audience as presence (friends, DM/group members, subscribed guild presence
channels) plus self. Clients refetch summaries/profiles. Privacy changes also emit it so viewers
drop sections they lost. No content travels in the event.

## Desktop

- `Avatar` renders the summary avatar (still frame at rest in lists; animated on hover, in the
  popout and the full view; reduced motion keeps stills) with initials fallback.
- Profile popout: anchored glass card from any avatar or name (messages, member and DM lists,
  friends). Banner (image or colour) on top, avatar overlapping it with presence, name,
  username, pronouns, custom status, pinned badges, activity, bio, member-since, note field and
  actions (message, add friend). Tinted by banner/accent colour; ambient layer follows it.
- Full profile view (modal): banner, identity, tabs `About`, `Mutual servers`, `Mutual friends`,
  `Activity`; Esc closes, focus returns to the trigger.
- Profile editor (settings → `Profile`, `Server profiles`): live preview card beside the form;
  avatar/banner pick, crop (pan/zoom, square or 5:2) and upload progress; colours with contrast
  hint; pronouns suggestions (EN/FR); bio with counter; privacy rows with audience selects.
- Custom status dialog from the user panel: emoji, text, clear-after (`30 minutes`, `1 hour`,
  `4 hours`, `Today`, `Never`).

## Acceptance

1. Integration tests prove each section's audience for stranger, guild co-member, friend,
   blocked and self, and that invisible owners leak neither custom status nor activity.
2. Avatar/banner replacement releases old media; CDN refuses a replaced, foreign-guild or
   audience-denied banner; summaries are capped and require membership for guild context.
3. Popout, full view and editor work in EN/FR, keyboard only, in every glass tier.
