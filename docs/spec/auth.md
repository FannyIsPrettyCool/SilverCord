# Spec: accounts, sessions, MFA

Phase 1. BRIEF §6.1, threat model T1–T5, T16, T19.

## Goal

People can register (subject to the instance registration mode), verify their email,
log in from the desktop client, stay logged in with rotating refresh tokens, see and
revoke their sessions, reset a forgotten password and protect the account with TOTP.

## Data model (`apps/server/src/modules/auth`, `users`)

| Table | Columns (all ids are snowflake `bigint`) | Indexes / notes |
|---|---|---|
| `users` | `id`, `username citext`, `display_name`, `email citext`, `email_verified_at`, `password_hash`, `is_instance_admin bool`, `locale`, `age_confirmed_at`, `username_changed_at`, `created_at`, `updated_at` | unique(`username`), unique(`email`) |
| `instance_settings` | `id smallint = 1` (single row), `registration_mode` (`open`/`invite_only`/`closed`), `updated_at` | check `id = 1` |
| `instance_invites` | `id`, `code` (unique), `created_by → users`, `max_uses`, `uses`, `expires_at`, `created_at` | unique(`code`); registration invites, distinct from guild invites |
| `sessions` | `id`, `user_id → users`, `device_name`, `user_agent`, `ip inet`, `created_at`, `last_used_at`, `revoked_at`, `revoked_reason` | (`user_id`, `revoked_at`); one session = one refresh-token family |
| `refresh_tokens` | `id`, `session_id → sessions`, `token_hash bytea`, `expires_at`, `used_at`, `created_at` | unique(`token_hash`), (`session_id`) |
| `email_tokens` | `id`, `user_id → users`, `purpose` (`verify_email`/`reset_password`), `token_hash bytea`, `expires_at`, `used_at`, `created_at` | unique(`token_hash`), (`user_id`, `purpose`) |
| `user_totp` | `user_id` PK → users, `secret_encrypted bytea`, `confirmed_at`, `created_at` | secret AES-256-GCM encrypted with `TOTP_ENCRYPTION_KEY` |
| `recovery_codes` | `id`, `user_id → users`, `code_hash bytea`, `used_at` | (`user_id`) |

All FKs `on delete cascade` from `users` (account deletion is real deletion, BRIEF §5.1).
IPs are kept on `sessions` only and cleared after 90 days by a cleanup job (§8.4).

## Tokens

- **Access token:** JWT HS256 (`jose`), 10 minutes, claims `sub` (user id string), `sid`
  (session id string), `iat`, `exp`, `iss = silvercord`. Sent as `Authorization: Bearer`.
  Every authenticated request checks that `sid` is not revoked (Valkey set
  `revoked-sessions`, populated on revoke, TTL = access lifetime; DB is the source of truth).
- **Refresh token:** 32 random bytes, base64url, prefixed `scr_`. Only its SHA-256 is stored.
  30-day lifetime. **Rotation:** each refresh marks the presented token used and issues a new
  one in the same session. **Reuse detection:** presenting an already-used token revokes the
  whole session (`revoked_reason = 'refresh_reuse'`) and returns `TOKEN_REUSED`.
  No grace window in v1: the desktop main process serializes refreshes, so a legitimate
  client never presents the same token twice.
- **MFA ticket:** JWT, 5 minutes, `typ = mfa`, `sub`, used only by `/auth/login/totp`.
- **Email tokens:** 32 random bytes, SHA-256 stored; verify 48 h, reset 30 min; single use.

## Passwords

Argon2id (`@node-rs/argon2`), m = 19456 KiB, t = 2, p = 1 (OWASP minimum), rehash on login
when parameters change. Length 10–256, NFKC-normalized. Optional HIBP k-anonymity check
behind `HIBP_ENABLED` (default off: it calls an external service).

## API (`/api/v1`)

| Method & path | Auth | Body → response | Rate limit |
|---|---|---|---|
| `POST /auth/register` | – | `{ email, username, password, displayName?, inviteCode?, ageConfirmed: true, locale }` → `201 AuthTokens` | 5/h per IP |
| `POST /auth/login` | – | `{ login, password, deviceName }` → `200 AuthTokens` or `200 { mfaRequired: true, ticket }` | 10/min per IP, 5/min per login |
| `POST /auth/login/totp` | ticket | `{ ticket, code }` or `{ ticket, recoveryCode }` → `AuthTokens` | 5/min per IP |
| `POST /auth/refresh` | – | `{ refreshToken }` → `AuthTokens` | 30/min per IP |
| `POST /auth/logout` | bearer | → `204`, revokes current session | default |
| `GET /auth/sessions` | bearer | → `Session[]` (current flagged) | default |
| `DELETE /auth/sessions/:id` | bearer | → `204` | default |
| `POST /auth/sessions/revoke-others` | bearer | → `204` ("log out everywhere" else) | default |
| `POST /auth/email/verify` | – | `{ token }` → `204` | 10/min per IP |
| `POST /auth/email/resend` | bearer | → `204` | 3/h per user |
| `POST /auth/password/forgot` | – | `{ email }` → `202` always | 3/h per IP, 3/h per email |
| `POST /auth/password/reset` | – | `{ token, password }` → `204`, revokes all sessions | 10/h per IP |
| `POST /auth/totp/setup` | bearer | → `{ secret, otpauthUri }` (unconfirmed) | 5/h per user |
| `POST /auth/totp/enable` | bearer | `{ code }` → `{ recoveryCodes: string[10] }` | 10/h per user |
| `POST /auth/totp/disable` | bearer | `{ password, code }` → `204` | 10/h per user |
| `GET /users/@me` | bearer | → `CurrentUser` | default |
| `POST /admin/invites` | bearer, instance admin | `{ maxUses?, expiresInHours? }` → `InstanceInvite` | 30/h per user |

`AuthTokens = { accessToken, accessTokenExpiresAt, refreshToken, user: CurrentUser }`.

## Rules

- **Registration modes:** `open`; `invite_only` (valid, unexpired, not exhausted invite;
  uses incremented in the same transaction); `closed` → `REGISTRATION_CLOSED`. The very
  first account ever created bypasses the mode and becomes instance admin.
- **Usernames:** 2–32 chars `[a-z0-9_.]`, no leading/trailing/double dots, stored lowercase,
  reserved list (`admin`, `system`, `silvercord`, `everyone`, `here`, …). Changing it has
  a 7-day cooldown (phase 5 endpoint).
- **Age:** `ageConfirmed` must be `true` (minimum age 15, France).
- **Enumeration resistance:** login failures always `INVALID_CREDENTIALS`, with an Argon2
  verify against a dummy hash for unknown accounts; forgot-password always `202`;
  register conflicts return `CONFLICT` with the field (email or username) — accepted risk,
  since registration is rate limited and usually invite-gated.
- **Email:** verification mail on register (and resend); reset mail; new-device alert when
  a login creates a session whose `(device_name, user_agent)` pair is new for that user.
  Unverified users can log in; `READY` carries `emailVerified` and later features may gate on it.
- **Password reset** revokes every session of the user.
- **TOTP:** RFC 6238, SHA-1, 6 digits, 30 s, ±1 step; a code cannot be reused within its
  window (last used step stored in Valkey). Recovery codes: 10 × 10 chars, single use, hashed.
- Revoking a session adds its id to the Valkey revocation set immediately.

## Gateway touchpoint

`IDENTIFY` carries the access token; the gateway validates it the same way as REST and
closes with `INVALID_SESSION` when the session is revoked (see `docs/spec/gateway.md`).

## Edge cases

- Concurrent refresh with the same token: one wins, the other sees `used_at` and triggers
  reuse revocation. The desktop main process serializes refreshes to avoid self-revocation.
- Invite exhausted between check and insert → transaction with `uses < max_uses` guard.
- Clock skew on JWT: 30 s tolerance.
- User deleted while holding tokens: refresh fails (`TOKEN_INVALID`), access fails on sid check.

## Acceptance criteria

1. First registration on an empty instance becomes admin regardless of mode.
2. Invite-only registration needs a valid invite; closed refuses with `REGISTRATION_CLOSED`.
3. Login → access + refresh; refresh rotates; replaying an old refresh token revokes the session.
4. Revoked session's access token is refused within one request.
5. Verification and reset emails arrive in Mailpit with working tokens; tokens are single-use.
6. TOTP-enabled login requires a valid code or an unused recovery code.
7. Every route has success, validation-failure, authz-failure and rate-limit integration tests.
8. No password, token or code appears in logs (redaction test).
