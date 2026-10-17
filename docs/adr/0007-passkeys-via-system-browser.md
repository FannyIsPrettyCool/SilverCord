# ADR-0007: Passkeys through the system browser

- Status: accepted
- Date: 2026-10-17

## Context

BRIEF §6.1 asks for passkeys (WebAuthn via `@simplewebauthn`). The renderer runs on the
custom `app://bundle` origin (ADR for Electron hardening, security recommendation 18).
A probe in Electron 44 on Linux showed:

- `navigator.credentials.create` fails with `SecurityError: Public-key credentials are only
  available to HTTPS origins with valid certificates, HTTP origins that fall under 'localhost',
  or pages served from an extension`.
- `isUserVerifyingPlatformAuthenticatorAvailable()` is `false`: Electron does not wire the OS
  passkey UI (Windows Hello, password managers) the way Chrome does.

## Options

1. Serve the renderer from `https://` or `http://localhost` to satisfy WebAuthn: gives up the
   custom-protocol hardening and still lacks the platform authenticator UI.
2. Hidden `BrowserWindow` on the instance's HTTPS origin: same missing authenticator UI.
3. **System browser + deep link** (RFC 8252 pattern): the client opens
   `https://<DOMAIN>/auth/passkey?flow=…` in the OS browser, which runs WebAuthn with the
   instance domain as RP ID and the browser's full passkey UI; the page hands a one-time code
   back through `silvercord://auth/passkey?code=…`, which the main process exchanges for tokens.

## Decision

Option 3. It needs a real HTTPS domain (end of phase 2) and the `silvercord://` deep-link
handler (phase 7), so passkeys move to phase 7, next to deep links and the download site
(which shares the public web origin).

## Consequences

- Phase 1 ships password + TOTP; passkeys are tracked in phase 7 of `docs/PLAN.md`.
- One-time codes must be single-use, short-lived (60 s), bound to a PKCE verifier held by the
  main process, and redeemable only once (threat model: code interception).
- Recorded in `docs/PLATFORM-LIMITS.md`.
