# Spec: badges

Phase 5; BRIEF §6.7. Shown on profiles under the `badges` audience (`profiles.md`).

## Model

- `badge_definitions`: snowflake id, `key` (unique, built-ins only, e.g. `early_member`) or null,
  `name` 1–32 and `description` ≤ 140 (admin badges; built-ins are localized by key),
  `rarity` (`common|uncommon|rare|epic|legendary|mythic`), icon: `icon_name` from the bundled
  set or `icon_upload_id` (`badge_icon` upload, ADR-0011), `rule` JSONB or null (manual),
  `retired` (no new awards; existing awards stay visible), `created_at`. Max 200 definitions.
- `user_badges`: PK (user, badge), both FK CASCADE; `level` ≥ 1 (anniversary years),
  `awarded_at`, `awarded_by` (user FK SET NULL; null for rules), `reason` ≤ 200 or null,
  `pin` 0–5 or null, UNIQUE (user, pin). Users pin up to 6; pinned badges lead, then rarity
  (rarest first), then newest.

## Built-in rules

Evaluated for a user when their badges are read (at most every 10 minutes per user, cached in
process) and after admin awards. Permanent rules never revoke; conditional rules revoke when
the condition stops holding.

| key | rule | rarity | kind |
|---|---|---|---|
| `founder` | first account on the instance | mythic | permanent |
| `early_member` | among the first 100 accounts | legendary | permanent |
| `anniversary` | account age ≥ 1 year; level = whole years | rare | permanent, level grows |
| `instance_admin` | instance administrator | epic | conditional |
| `server_owner` | owns at least one guild | uncommon | conditional |
| `verified` | verified email | common | conditional |
| `secured` | MFA enabled | uncommon | conditional |

## REST

| Method/path | Contract | Auth / bucket |
|---|---|---|
| GET `/badges` | definitions (not retired + any the viewer holds) | user, badges.read 30/1 |
| GET `/users/@me/badges` | own awards incl. pins | user, badges.read |
| PUT `/users/@me/badges/pins` | `{badgeIds}` ≤ 6 held, unique, in order → own awards | user, badges.write 10/(1/3) |
| POST `/admin/badges` | create manual badge | instance-admin, admin.badges 30/(30/3600) |
| PATCH `/admin/badges/:badgeId` | name, description, rarity, icon, retired | instance-admin |
| POST `/admin/badges/:badgeId/awards` | `{username, reason}` → award (idempotent) | instance-admin |
| DELETE `/admin/badges/:badgeId/awards/:userId` | revoke a manual award → 204 | instance-admin |

Built-in definitions cannot be edited or awarded by hand. Awards and revocations emit
`PROFILE_CHANGED` for the holder. Admin actions are logged with actor, badge and target ids.
A CLI (`src/modules/badges/badge-cli.ts`) creates and awards badges on the host.

## Desktop

Built-in tooltip copy (EN; FR in the locale file): "First account on this instance",
"Among the first hundred accounts", "Member for # years", "Runs this instance",
"Owns a server", "Verified email address", "Two-factor authentication on".

Badge shelf on the profile card (pinned first, up to 8 then "+n"), each a round medallion with
a rarity-coloured rim; hover/focus shows name, description, level and award date. Settings ›
Profile lets users pin up to 6. Instance admins get Settings › Badges to create and award.
