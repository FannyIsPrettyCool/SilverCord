import { chmod, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ActivityInput, activityInputSchema } from '@silvercord/protocol';
import { z } from 'zod';

/** docs/rpc.md */
export const RPC_LINE_MAX = 16 * 1024;
export const RPC_CONNECTIONS_MAX = 4;
export const RPC_UPDATES = { count: 5, windowMs: 15_000 } as const;
const SLOTS = 10;

const clientNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));

export const rpcMessageSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('hello'),
    v: z.literal(1),
    client: z.object({ name: clientNameSchema }),
  }),
  z.object({
    op: z.literal('set_activity'),
    nonce: z.string().max(64).optional(),
    // Unknown keys are ignored (docs/rpc.md); validation happens on the known ones.
    activity: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal('clear_activity'), nonce: z.string().max(64).optional() }),
]);

const ACTIVITY_KEYS = [
  'type',
  'name',
  'details',
  'state',
  'startedAt',
  'endsAt',
  'buttons',
] as const;

/** Keeps the documented keys only, then validates; the client name is set by us. */
export function parseRpcActivity(
  raw: Record<string, unknown>,
  client: string,
): ActivityInput | null {
  const picked: Record<string, unknown> = { application: client };
  for (const key of ACTIVITY_KEYS) if (key in raw) picked[key] = raw[key];
  const parsed = activityInputSchema.safeParse(picked);
  return parsed.success ? parsed.data : null;
}

export function rpcAddress(slot: number, platform = process.platform): string {
  if (platform === 'win32') return `\\\\?\\pipe\\silvercord-rpc-${slot}`;
  return join(process.env['XDG_RUNTIME_DIR'] ?? tmpdir(), `silvercord-rpc-${slot}`);
}

/** Splits a byte stream into lines, refusing any line longer than the limit. */
export function lineReader(onLine: (line: string) => void, onOverflow: () => void) {
  let buffer = '';
  return (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > RPC_LINE_MAX) return onOverflow();
      if (line.trim()) onLine(line);
    }
    if (buffer.length > RPC_LINE_MAX) onOverflow();
  };
}

export type RpcDecision = 'allowed' | 'denied' | 'unknown';

export interface RpcServerOptions {
  /** What the user decided about this program before; unknown ones wait for a decision. */
  readonly decision: (client: string) => RpcDecision;
  /** A program asks for the first time. */
  readonly onRequest: (client: string) => void;
  /** The newest activity from allowed programs, or null. */
  readonly onChange: (activity: ActivityInput | null) => void;
  readonly now?: () => number;
}

interface Connection {
  readonly socket: Socket;
  client: string | null;
  state: 'new' | 'pending' | 'ready';
  activity: ActivityInput | null;
  updatedAt: number;
  updates: number[];
}

/** Local rich-presence endpoint (docs/rpc.md); only listens while Local RPC is on. */
export function createRpcServer(options: RpcServerOptions) {
  const now = options.now ?? Date.now;
  const connections = new Set<Connection>();
  let server: Server | null = null;
  let address: string | null = null;

  const send = (connection: Connection, message: object) => {
    if (!connection.socket.destroyed) connection.socket.write(`${JSON.stringify(message)}\n`);
  };
  const fail = (connection: Connection, code: string, nonce?: string, close = false) => {
    send(connection, { v: 1, op: 'error', code, ...(nonce ? { nonce } : {}) });
    if (close) connection.socket.end();
  };

  function publish() {
    let newest: Connection | null = null;
    for (const connection of connections)
      if (connection.state === 'ready' && connection.activity)
        if (!newest || connection.updatedAt > newest.updatedAt) newest = connection;
    options.onChange(newest?.activity ?? null);
  }

  function handle(connection: Connection, line: string) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return fail(connection, 'INVALID');
    }
    const parsed = rpcMessageSchema.safeParse(json);
    if (!parsed.success) return fail(connection, 'INVALID');
    const message = parsed.data;
    if (message.op === 'hello') {
      if (connection.state !== 'new') return fail(connection, 'INVALID');
      connection.client = message.client.name;
      const decision = options.decision(message.client.name);
      if (decision === 'denied') return fail(connection, 'DENIED', undefined, true);
      connection.state = decision === 'allowed' ? 'ready' : 'pending';
      send(connection, { v: 1, op: connection.state === 'ready' ? 'ready' : 'pending' });
      if (decision === 'unknown') options.onRequest(message.client.name);
      return;
    }
    if (connection.state === 'new' || !connection.client)
      return fail(connection, 'INVALID', message.nonce);
    if (message.op === 'set_activity') {
      const at = now();
      connection.updates = connection.updates.filter((time) => at - time < RPC_UPDATES.windowMs);
      if (connection.updates.length >= RPC_UPDATES.count)
        return fail(connection, 'RATE_LIMITED', message.nonce);
      const activity = parseRpcActivity(message.activity, connection.client);
      if (!activity) return fail(connection, 'INVALID', message.nonce);
      connection.updates.push(at);
      connection.activity = activity;
      connection.updatedAt = at;
    } else {
      connection.activity = null;
    }
    send(connection, { op: 'ack', ...(message.nonce ? { nonce: message.nonce } : {}) });
    if (connection.state === 'ready') publish();
  }

  function accept(socket: Socket) {
    if (connections.size >= RPC_CONNECTIONS_MAX) {
      socket.end(`${JSON.stringify({ v: 1, op: 'error', code: 'BUSY' })}\n`);
      return;
    }
    const connection: Connection = {
      socket,
      client: null,
      state: 'new',
      activity: null,
      updatedAt: 0,
      updates: [],
    };
    connections.add(connection);
    socket.setNoDelay(true);
    socket.on(
      'data',
      lineReader(
        (line) => handle(connection, line),
        () => {
          fail(connection, 'INVALID');
          socket.destroy();
        },
      ),
    );
    const drop = () => {
      if (!connections.delete(connection)) return;
      if (connection.activity && connection.state === 'ready') publish();
    };
    socket.on('close', drop);
    socket.on('error', drop);
  }

  /** A unix socket left by a crashed instance is removed only if nobody answers on it. */
  async function clearStale(path: string) {
    if (process.platform === 'win32') return;
    const alive = await new Promise<boolean>((resolve) => {
      const probe = createConnection(path);
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
    });
    if (!alive) await unlink(path).catch(() => undefined);
  }

  async function listenOn(slot: number): Promise<boolean> {
    const path = rpcAddress(slot);
    await clearStale(path);
    const candidate = createServer(accept);
    const ok = await new Promise<boolean>((resolve) => {
      candidate.once('error', () => resolve(false));
      candidate.listen(path, () => resolve(true));
    });
    if (!ok) {
      candidate.close();
      return false;
    }
    if (process.platform !== 'win32') await chmod(path, 0o600).catch(() => undefined);
    server = candidate;
    address = path;
    return true;
  }

  return {
    async start(): Promise<string | null> {
      if (server) return address;
      for (let slot = 0; slot < SLOTS; slot += 1) if (await listenOn(slot)) return address;
      return null;
    },
    async stop() {
      for (const connection of connections) {
        fail(connection, 'DISABLED');
        connection.socket.destroy();
      }
      connections.clear();
      const closing = server;
      server = null;
      address = null;
      await new Promise<void>((resolve) => (closing ? closing.close(() => resolve()) : resolve()));
      options.onChange(null);
    },
    /** The user decided about a waiting program. */
    decide(client: string, allow: boolean) {
      for (const connection of connections) {
        if (connection.client !== client || connection.state !== 'pending') continue;
        if (allow) {
          connection.state = 'ready';
          send(connection, { v: 1, op: 'ready' });
        } else fail(connection, 'DENIED', undefined, true);
      }
      if (allow) publish();
    },
    get address() {
      return address;
    },
  };
}
export type RpcServer = ReturnType<typeof createRpcServer>;
