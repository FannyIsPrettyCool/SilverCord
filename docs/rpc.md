# Local RPC (rich presence) — protocol v1

Other programs on the same computer can set your SilverCord activity ("Playing …",
"Listening to …") while the desktop app runs and **Local RPC** is turned on in Settings ›
Activity. The connection never leaves the machine and needs no token: the first time a program
connects, SilverCord asks you to allow or deny it by name. Denied programs are ignored.

## Endpoint

| OS | Address |
|---|---|
| Windows | named pipe `\\?\pipe\silvercord-rpc-0` (next free `-1` … `-9` if taken) |
| Linux | unix socket `$XDG_RUNTIME_DIR/silvercord-rpc-0` (fallback: OS temp dir), mode `0600` |

## Framing

UTF-8 JSON objects, one per line (`\n`). A line may be at most 16 KiB. Up to 4 programs may be
connected at once. A program may send at most 5 activity updates per 15 seconds; extra updates
get an `error` with code `RATE_LIMITED`.

## Messages

1. Client → `{"v":1,"op":"hello","client":{"name":"My Game"}}` (name 1–64 characters).
2. Server → `{"v":1,"op":"ready"}` once allowed, or `{"v":1,"op":"pending"}` while the user
   decides (then `ready` or `{"op":"error","code":"DENIED"}` and the connection closes).
3. Client → `{"op":"set_activity","nonce":"1","activity":{...}}`, where `activity` is:

   ```json
   {
     "type": "playing",
     "name": "Starfield Run",
     "details": "Sector 7",
     "state": "Solo",
     "startedAt": "2026-10-18T20:00:00Z",
     "endsAt": null,
     "buttons": [{ "label": "Watch", "url": "https://example.org/live" }]
   }
   ```

   `type` is `playing`, `listening`, `watching`, `streaming` or `competing`; text fields are
   plain text (≤ 128, labels ≤ 32); buttons are https links, at most two.
4. Server → `{"op":"ack","nonce":"1"}` or `{"op":"error","nonce":"1","code":"INVALID","message":"…"}`.
5. Client → `{"op":"clear_activity","nonce":"2"}` → `ack`. Closing the connection also clears
   that program's activity.

Error codes: `INVALID` (bad message), `RATE_LIMITED`, `DENIED`, `DISABLED` (Local RPC was turned
off), `BUSY` (too many programs). Unknown `op` values are `INVALID`. The server ignores unknown
keys inside `activity`.

## Example client (Node.js)

```js
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path = process.platform === 'win32'
  ? '\\\\?\\pipe\\silvercord-rpc-0'
  : join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'silvercord-rpc-0');
const socket = connect(path);
const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
socket.on('data', (data) => process.stdout.write(data));
send({ v: 1, op: 'hello', client: { name: 'Example' } });
send({
  op: 'set_activity',
  nonce: '1',
  activity: { type: 'playing', name: 'Example Game', startedAt: new Date().toISOString() },
});
```

`tools/rpc-example.mjs` is this script; run it with `node tools/rpc-example.mjs`.
