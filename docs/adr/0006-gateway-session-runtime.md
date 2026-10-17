# ADR-0006: Gateway session runtimes and resume scope

- Status: accepted
- Date: 2026-10-17

## Context

`RESUME` must replay events that happened while a client was offline (BRIEF §5.3). Events
reach a gateway process through Valkey pub/sub, which has no memory: if nothing is subscribed
while the client is offline, those events are gone. The first implementation subscribed per
socket and therefore replayed nothing after a real disconnect (caught by the conformance test).

## Options

1. **Per-socket subscriptions** (initial): simple, but resume only covers events published while
   the socket was still open. Not acceptable.
2. **Per-session runtime that outlives the socket**: subscriptions, sequence assignment and
   buffering belong to the gateway session; the socket only attaches/detaches. A resuming socket
   adopts the runtime inside its serial queue, so replay and live events cannot interleave.
3. **Durable per-user event log** (Valkey streams per user, consumers read from an offset):
   resume works on any process, at the cost of a stream per user and fan-out writes per user.

## Decision

Option 2 for v1. The runtime lives for the 5-minute resume window after a disconnect, then
unsubscribes; the Valkey session hash and event stream expire on the same window.

## Consequences

- Resume only succeeds on the process that holds the runtime. With one API process (v1) that is
  always the case. Before running several gateway processes, either route `gw.` connections
  stickily by session or move to option 3; this ADR must be revisited then.
- A process restart drops all runtimes; clients get `INVALID_SESSION` and identify again.
- Memory: one runtime per recently connected session; bounded by connections per user (10)
  and the 5-minute window.
