# Spec: real-time gateway

Phase 1 (skeleton), extended in phases 2–4. BRIEF §5.3, threat model T11, T12.

## Goal

One WebSocket per client that delivers every real-time event in order, survives short
network blips without losing events, and can be scaled to several processes later.

## Transport

- URL: `/gateway/v1` (dev `ws://localhost:4000/gateway/v1`, prod `wss://gw.<DOMAIN>/gateway/v1`).
- Text frames, JSON. `permessage-deflate` on (threshold 1 KiB). zstd is not used: no stable,
  verified implementation in both `ws` and Chromium at the time of writing.
- Inbound frame limit 16 KiB (larger frames close with 1009). Outbound unbounded but events
  are kept small by design.
- The access token is sent in `IDENTIFY` / `RESUME`, never in the URL.

## Frame

```json
{ "op": 0, "d": {}, "s": 42, "t": "READY" }
```

`s` and `t` appear only on `DISPATCH`.

## Opcodes

| Code | Name | Direction | Payload |
|---|---|---|---|
| 0 | `DISPATCH` | S→C | `t` event name, `s` sequence, `d` event data |
| 1 | `HEARTBEAT` | C→S | `{ seq: number \| null }` last sequence received |
| 2 | `IDENTIFY` | C→S | `{ token, client: { name, version, os } }` |
| 3 | `RESUME` | C→S | `{ token, sessionId, seq }` |
| 4 | `SUBSCRIBE` | C→S | lazy subscriptions (`{ guildId, memberRanges }`, phase 3) |
| 7 | `RECONNECT` | S→C | `{}` — server asks the client to reconnect and resume |
| 9 | `INVALID_SESSION` | S→C | `{ resumable: boolean }` |
| 10 | `HELLO` | S→C | `{ heartbeatIntervalMs }` sent on connect |
| 11 | `HEARTBEAT_ACK` | S→C | `{}` |

`READY` (after IDENTIFY) and `RESUMED` (after RESUME) are `DISPATCH` events; `READY` is always
sequence 1 of a new session.

## Lifecycle

1. Server sends `HELLO { heartbeatIntervalMs: 41250 }`.
2. Client sends `IDENTIFY` within 10 s, otherwise close `4003`.
3. Server validates the access token like REST (signature, expiry, session revocation), creates a
   gateway session and dispatches `READY { sessionId, user, heartbeatIntervalMs }`.
4. Client heartbeats every `heartbeatIntervalMs` (first one after a random jitter). The server
   replies `HEARTBEAT_ACK`. No heartbeat for 2 × interval closes with `4009` (resumable).
5. On disconnect, the gateway session is kept for 5 minutes. `RESUME` with the last received
   `seq` replays every buffered event with a higher sequence, then dispatches `RESUMED`.
6. Unknown, expired or foreign sessions, or a `seq` older than the buffer, get
   `INVALID_SESSION { resumable: false }`; the client then identifies again.

The desktop starts heartbeat timers only after READY or RESUMED. A missed ACK detaches the
socket immediately and schedules a resume without waiting for the browser close handshake.
Token requests belong to their original socket; late results cannot authenticate a replacement.
Only terminal token errors end the login session. Network errors, rate limits and server failures
retry with backoff, including during re-identification after INVALID_SESSION.

## Close codes

| Code | Meaning | Client action |
|---|---|---|
| 4000 | Unknown error | resume |
| 4001 | Unknown opcode | resume |
| 4002 | Decode error (not JSON / schema) | resume |
| 4003 | Not authenticated (op before IDENTIFY, or IDENTIFY timeout) | identify |
| 4004 | Authentication failed / session revoked | refresh token, then identify; give up on second failure |
| 4005 | Already authenticated | resume |
| 4008 | Rate limited | resume after backoff |
| 4009 | Session timed out (no heartbeat) | resume |

## Sessions and replay (Valkey)

- `gw:session:<id>` hash: `userId`, `authSessionId`, `seq`. TTL refreshed while connected,
  5 minutes after disconnect.
- `gw:session:<id>:events` stream: each dispatched frame (`seq`, serialized frame), trimmed to
  the last 5 minutes (`MINID`) and 1 000 entries, TTL as the hash.
- Session ids: 128-bit random, base64url. Resume requires the same user as the token.
- A per-session runtime keeps the session's subscriptions and keeps buffering for the resume
  window after the socket closes; the resuming socket adopts it (ADR-0006).

## Fan-out

- Producers (REST services, workers) publish to Valkey pub/sub channels; every gateway process
  subscribes to the channels its connected users need. v1 runs one process but the path is the
  same (BRIEF §5.3, horizontal-ready).
- Phase 1 channels: `gw:user:<userId>` (events for one user) and
  `gw:auth-session:<authSessionId>` (kick when the REST session is revoked).
- Phase 2+ adds per-channel/guild channels; presence goes only to friends and shared guilds,
  coalesced; member lists via `SUBSCRIBE` ranges (phase 3).

## Phase 1 events

| Event | Data | Trigger |
|---|---|---|
| `READY` | `{ sessionId, user: CurrentUser, heartbeatIntervalMs }` | IDENTIFY |
| `RESUMED` | `{ replayed: number }` | RESUME |
| `USER_UPDATE` | `CurrentUser` | email verified, TOTP toggled |

## Limits

- 120 client ops per 60 s per connection (token bucket, local); excess closes `4008`.
- At most 1 IDENTIFY or RESUME per connection (`4005` on repeat).
- At most 10 concurrent connections per user. Connections beyond the cap are refused with
  `4008` rather than evicting the oldest, so a stolen token can't kick the owner off.

## Acceptance criteria (conformance tests)

1. HELLO arrives first; IDENTIFY with a valid token yields READY with `s = 1`.
2. Invalid, expired or revoked tokens close with 4004; ops before IDENTIFY close with 4003.
3. HEARTBEAT is acknowledged; silence beyond 2 × interval closes with 4009.
4. Events dispatched while disconnected are replayed in order on RESUME, followed by RESUMED.
5. RESUME with an unknown session or another user's session yields INVALID_SESSION `resumable: false`.
6. Revoking the REST session closes the socket with 4004.
7. Malformed JSON closes 4002, unknown op 4001, oversize frame 1009, op flood 4008.
