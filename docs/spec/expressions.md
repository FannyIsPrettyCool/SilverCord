# Spec: emotes, stickers, emoji and GIF pickers

Phase 5; BRIEF §6.6. Media per ADR-0011 (`emote`, `sticker` purposes).

## Model

- `guild_emotes`: snowflake id, guild FK CASCADE, `name` `[A-Za-z0-9_]{2,32}` unique per guild
  (case-insensitive), `upload_id` (media FK RESTRICT, purpose `emote`), `animated`,
  `created_by` (user FK SET NULL), `created_at`. Max 250 static + 250 animated per guild.
- `guild_stickers`: snowflake id, guild FK CASCADE, `name` 2–30, `description` ≤ 100,
  `related_emoji` (one unicode emoji) or null, `upload_id` (purpose `sticker`), `animated`,
  `created_by`, `created_at`. Max 60 per guild.
- Deleting an emote or sticker releases its upload (purged after commit). Leaving a guild keeps
  the guild's emotes; they belong to the guild.

## Message tokens (no payload change, ADR-0011 §5)

- Emote `<:name:id>`, animated `<a:name:id>`; sticker `<sticker:id>` (a message holds at most
  three stickers). Parsed by `@silvercord/markdown` into `emote` / `sticker` inline nodes.
- On send/edit the server checks every token: emotes and stickers must exist and the sender
  must be a member of their guild (in a guild channel, an emote from another guild also needs
  USE_EXTERNAL_EMOJIS there). An emote the sender may not use is rewritten to `:name:`; an
  unusable sticker token is removed. Names in tokens are rewritten to the current name.
- Viewing never needs membership: any signed-in user may load a live emote or sticker image.
  Deleted ones render as `:name:` (emote) or nothing (sticker).
- Reactions accept `custom:<emoteId>` beside unicode emoji, with the same usability rule.

## REST

| Method/path | Contract | Auth / bucket |
|---|---|---|
| GET `/guilds/:guildId/expressions` | `{emotes, stickers}` | member, expressions.read 30/1 |
| POST `/guilds/:guildId/emotes` | `{name, uploadId}` → emote | MANAGE_EMOJIS, expressions.write 20/(1/3) |
| PATCH/DELETE `/guilds/:guildId/emotes/:emoteId` | `{name}` / → 204 | MANAGE_EMOJIS |
| POST `/guilds/:guildId/stickers` | `{name, description, relatedEmoji, uploadId}` | MANAGE_EMOJIS |
| PATCH/DELETE `/guilds/:guildId/stickers/:stickerId` | | MANAGE_EMOJIS |
| GET `/users/@me/expressions` | usable emotes/stickers grouped by guild (picker) | user, expressions.read |
| GET `/expressions/lookup` | `emoteIds`, `stickerIds` (≤ 100 each) → images for rendering | user, expressions.lookup 120/4 |

Uploads: `POST /uploads` with purpose `emote` (≤ 512 KiB, fit 128 px) or `sticker` (≤ 1 MiB,
fit 320 px) and the guildId; needs MANAGE_EMOJIS. Changes emit `GUILD_CHANGED` to members.

## Emoji picker

Unicode 16 data from `emojibase-data` 17 (MIT) in EN/FR, drawn with the bundled Noto Color
Emoji font (OFL-1.1, credited in the about view): categories, search by name, shortcode and
keyword in the UI language, skin-tone choice (remembered), recents (per account, 32), and a
section per guild for custom emotes. Opened from the composer, the reaction button and the
custom status dialog; keyboard: arrows move, Enter picks, Escape closes; typed `:sho` in the
composer suggests matches.

## GIF picker

Tenor's API shut down on 2026-06-30. Provider: Klipy, proxied by the server so clients never
contact it: `GET /gifs/trending`, `GET /gifs/search?q=` (cached 10 min in Valkey, per-user
rate limited), media streamed through the CDN origin's `/gifs/...` route with the SSRF-safe
fetcher (allow-listed Klipy hosts only). Disabled (routes 404, picker hidden) until
`KLIPY_API_KEY` is set. Attribution "Powered by KLIPY" in the picker as their terms require.
