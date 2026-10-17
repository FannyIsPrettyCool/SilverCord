# Threat model

Living document (BRIEF §8.1). Written in phase 1, revisited at every phase boundary.
Target: OWASP ASVS Level 2.

## Assets

| Asset | Why it matters |
|---|---|
| Account credentials (password hashes, TOTP secrets, recovery codes, passkeys) | Account takeover |
| Session tokens (access JWT, refresh tokens) | Account takeover without credentials |
| Private messages, DMs, attachments | Confidentiality of users' conversations |
| Permission state (roles, overwrites, bans) | Integrity of every authorization decision |
| Instance secrets (JWT signing key, DB/Valkey/LiveKit/S3 credentials, SMTP) | Full compromise |
| Desktop client integrity (app bundle, update feed) | Code execution on every user's machine |
| Availability of voice/chat | The product |

## Actors

1. **Anonymous internet attacker** — reaches public endpoints (API, gateway, CDN, LiveKit, TURN).
2. **Malicious registered user** — has a valid account, tries to escalate, scrape, spam or harass.
3. **Malicious guild moderator/admin** — legitimate elevated rights in one guild, tries to exceed them.
4. **Malicious content** — links, images, files, markdown, widget JSON crafted to exploit clients or the server.
5. **Network attacker** — on the user's network (café Wi-Fi).
6. **Compromised dependency** — npm supply chain.
7. **Operator mistakes** — misconfiguration, lost backups.

## Trust boundaries

```
[Renderer (untrusted content)] -IPC(Zod+sender check)-> [Electron main]
[Client] -TLS-> [Caddy] -> [API / Gateway] -> [Postgres, Valkey, S3]
[API] -> [Fetch worker: unfurl, image proxy, integrations] -> [Internet]   (no secrets, SSRF guard)
[Client] -DTLS/SRTP-> [LiveKit] <-token(signed by API)
[Update feed] -signature-> [electron-updater]
```

## Threats and mitigations (STRIDE)

| # | Threat | Boundary | Mitigation | Phase | Test |
|---|---|---|---|---|---|
| T1 | Credential stuffing / brute force on login | Client→API | Per-IP + per-account token buckets, Argon2id, generic errors, optional HIBP check | 1 | rate-limit integration tests |
| T2 | Account enumeration via register/login/reset | Client→API | Uniform responses and timing for unknown accounts; reset always "sent" | 1 | auth tests |
| T3 | Stolen refresh token reused | Client→API | Rotation with family reuse detection → whole family revoked | 1 | reuse-detection test |
| T4 | Stolen access token | Client→API | 10-minute JWT lifetime, session id claim checked against revocation set | 1 | revocation test |
| T5 | Token theft from disk | Desktop | Refresh token only in `safeStorage`; never in localStorage or logs | 1 | security checklist test |
| T6 | XSS in renderer from message content | Content→Renderer | Markdown → AST rendered by React (no HTML strings), strict CSP, no `dangerouslySetInnerHTML` | 1–2 | CSP test, parser fuzz |
| T7 | Renderer compromise → OS code execution | Renderer→Main | contextIsolation, sandbox, no Node, minimal typed bridge, Zod on every IPC, sender-frame check, navigation/popup lockdown, fuses | 1 | security checklist test |
| T8 | Privilege escalation in guilds | API | Single permission engine, every mutating route declares permission, hierarchy rules, property tests | 3 | permission matrix + CI route check |
| T9 | SSRF via link unfurl / image proxy / widgets | API→Internet | Own DNS resolution, block private/loopback/link-local/metadata (v4+v6), pin IP, caps, isolated worker | 2, 6 | SSRF tests |
| T10 | Malicious uploads (polyglots, SVG XSS, EXIF leak) | Client→API→CDN | Content sniffing, SVG rejected, EXIF stripped, separate CDN origin, nosniff | 2 | upload tests |
| T11 | Gateway abuse (floods, huge frames, many sockets) | Client→Gateway | Payload size cap, per-connection op rate limit, identify timeout, per-user socket cap | 1 | conformance tests |
| T12 | Cross-user data leaks via gateway fan-out | Gateway | Subscriptions checked by permission engine; presence only to friends/shared guilds | 1–3 | fan-out tests |
| T13 | LiveKit room hijack | Client→LiveKit | Short-lived tokens from API after permission check; grants per source | 4 | token tests |
| T14 | Malicious update | Update feed | Signed artifacts, HTTPS feed, ASAR integrity fuse | 7 | update test |
| T15 | Supply-chain compromise | Build | Exact pins, lockfile, `pnpm audit` in CI, build-script allow-list, minimal deps | 0+ | CI |
| T16 | Secrets leakage | Repo/Logs | `.env` ignored, Zod env, pino redaction of auth headers/tokens | 1 | redaction test |
| T17 | Data loss | Ops | Nightly encrypted backups, tested restore drill | 2, 8 | restore drill |
| T18 | Spam / harassment | Users | Rate limits, blocks, reports, AutoMod, moderation tools | 2–3 | feature tests |
| T19 | CSRF | Client→API | Bearer tokens only (no cookie auth); CORS restricted to app origins | 1 | CORS test |

## Phase 1 decisions

- Access token: JWT (HS256 with a 256-bit secret from env), 10 min, claims `sub`, `sid`, `iat`, `exp`.
- Refresh token: 256-bit random, stored hashed (SHA-256) server-side, rotated on every use,
  30-day idle expiry; each rotation chain is a *family*; presenting a used token revokes the family.
- Password hashing: Argon2id via `@node-rs/argon2` (OWASP parameters: m=19 MiB, t=2, p=1 minimum).
- Logging redacts `authorization`, `password`, `token`, `refreshToken`, `totp`, `code`.

## Review log

- 2026-10-17: initial version (phase 1).
