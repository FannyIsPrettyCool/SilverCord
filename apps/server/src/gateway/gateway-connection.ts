import {
  type ClientFrame,
  type CurrentUser,
  clientFrameSchema,
  GatewayClose,
  GatewayOp,
  type ServerFrame,
} from '@silvercord/protocol';
import type { WebSocket } from 'ws';
import type { AccessClaims, TokenIssuer } from '../modules/auth/crypto/access-tokens.ts';
import type { SessionRevocations } from '../modules/auth/session-revocations.ts';
import type { EventSubscriber } from './event-bus.ts';
import {
  type AttachedSocket,
  createSessionRuntime,
  type SessionRuntime,
} from './session-runtime.ts';
import type { SessionStore } from './session-store.ts';

export interface GatewayOptions {
  readonly heartbeatIntervalMs: number;
  readonly identifyTimeoutMs: number;
  readonly opsPerMinute: number;
  readonly maxConnectionsPerUser: number;
}

/** Per-process state shared by every connection. */
export interface GatewayState {
  /** Live and detached session runtimes of this process, by gateway session id. */
  readonly runtimes: Map<string, SessionRuntime>;
  /** Connected sockets per user (v1 runs one gateway process). */
  readonly connectionsPerUser: Map<bigint, number>;
}

export interface ConnectionDependencies {
  readonly tokens: TokenIssuer;
  readonly revocations: SessionRevocations;
  readonly sessions: SessionStore;
  readonly subscriber: EventSubscriber;
  readonly loadUser: (userId: bigint) => Promise<CurrentUser>;
  /** Authoritative (database) check that the REST session behind a socket is still valid. */
  readonly isAuthSessionActive: (sessionId: bigint) => Promise<boolean>;
  readonly state: GatewayState;
  readonly log: { warn(object: object, message: string): void };
}

/** ~3.5 minutes at the default 41.25 s interval. */
const REVALIDATE_EVERY_HEARTBEATS = 5;

/** Local token bucket: the connection is pinned to this process, so no shared state is needed. */
function createOpBudget(perMinute: number) {
  let tokens = perMinute;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(perMinute, tokens + ((now - last) / 60_000) * perMinute);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/** One socket's protocol state machine (docs/spec/gateway.md). Events flow through a runtime. */
export function handleConnection(
  socket: WebSocket,
  deps: ConnectionDependencies,
  options: GatewayOptions,
) {
  let state: 'awaiting-auth' | 'authenticating' | 'ready' | 'closed' = 'awaiting-auth';
  let runtime: SessionRuntime | null = null;
  let countedUser: bigint | null = null;
  const spendOp = createOpBudget(options.opsPerMinute);
  const { runtimes, connectionsPerUser } = deps.state;

  const sendRaw = (frame: string) => {
    if (socket.readyState === socket.OPEN) socket.send(frame);
  };
  const send = (frame: ServerFrame) => sendRaw(JSON.stringify(frame));

  function close(code: number) {
    if (state === 'closed') return;
    state = 'closed';
    socket.close(code);
  }

  const attachment: AttachedSocket = {
    sendRaw,
    kick: () => close(GatewayClose.AUTHENTICATION_FAILED),
  };

  let heartbeatTimer: NodeJS.Timeout | undefined;
  let heartbeats = 0;
  const armHeartbeatDeadline = () => {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(
      () => close(GatewayClose.SESSION_TIMED_OUT),
      options.heartbeatIntervalMs * 2,
    );
  };
  const startIdentifyDeadline = () =>
    setTimeout(() => {
      if (state === 'awaiting-auth') close(GatewayClose.NOT_AUTHENTICATED);
    }, options.identifyTimeoutMs);
  let identifyTimer = startIdentifyDeadline();

  function reserveConnection(userId: bigint): boolean {
    const count = connectionsPerUser.get(userId) ?? 0;
    if (count >= options.maxConnectionsPerUser) return false;
    connectionsPerUser.set(userId, count + 1);
    countedUser = userId;
    return true;
  }

  function releaseConnection() {
    if (countedUser === null) return;
    const count = (connectionsPerUser.get(countedUser) ?? 1) - 1;
    if (count <= 0) connectionsPerUser.delete(countedUser);
    else connectionsPerUser.set(countedUser, count);
    countedUser = null;
  }

  /** Returns null (after closing the socket) when the token is unusable. */
  async function authenticate(token: string): Promise<AccessClaims | null> {
    let claims: AccessClaims;
    try {
      claims = await deps.tokens.verifyAccessToken(token);
      if (await deps.revocations.isRevoked(claims.sessionId)) throw new Error('revoked');
    } catch {
      close(GatewayClose.AUTHENTICATION_FAILED);
      return null;
    }
    if (!reserveConnection(claims.userId)) {
      close(GatewayClose.RATE_LIMITED);
      return null;
    }
    return claims;
  }

  /**
   * Detached runtimes stay alive for the resume window; cap how many one user may accumulate so
   * reconnect loops can't grow memory without bound (ADR-0006). Oldest detached go first.
   */
  function evictDetachedRuntimes(userId: bigint) {
    const mine = [...runtimes.values()].filter((candidate) => candidate.session.userId === userId);
    const detached = mine.filter((candidate) => !candidate.isAttached());
    const excess = mine.length - options.maxConnectionsPerUser * 2 + 1;
    for (const stale of detached.slice(0, Math.max(0, excess))) void stale.dispose();
  }

  /** The socket may close during any await of a handshake; every step re-checks. */
  const isClosed = () => state === 'closed' || socket.readyState !== socket.OPEN;

  async function identify(frame: Extract<ClientFrame, { op: 2 }>) {
    const claims = await authenticate(frame.d.token);
    if (!claims || isClosed()) return;
    evictDetachedRuntimes(claims.userId);
    const session = await deps.sessions.create(claims.userId, claims.sessionId);
    const created = await createSessionRuntime(session, {
      sessions: deps.sessions,
      subscriber: deps.subscriber,
      onError: (error) => deps.log.warn({ err: error }, 'gateway session task failed'),
      onDisposed: (disposed) => runtimes.delete(disposed.session.id),
      initialSocket: attachment,
      firstEvent: async () => ({
        t: 'READY',
        d: {
          sessionId: session.id,
          user: await deps.loadUser(claims.userId),
          heartbeatIntervalMs: options.heartbeatIntervalMs,
        },
      }),
    });
    if (isClosed()) {
      // Nobody will ever resume a session whose READY was never delivered.
      await created.dispose();
      await deps.sessions.destroy(session.id);
      return;
    }
    runtimes.set(session.id, created);
    runtime = created;
    state = 'ready';
  }

  async function resume(frame: Extract<ClientFrame, { op: 3 }>) {
    const claims = await authenticate(frame.d.token);
    if (!claims || isClosed()) return;
    const candidate = runtimes.get(frame.d.sessionId);
    // Same user *and* same auth session: a revoke of that auth session must still kick it.
    const owned =
      candidate !== undefined &&
      candidate.session.userId === claims.userId &&
      candidate.session.authSessionId === claims.sessionId;
    const adopted = owned
      ? await candidate.run(async () => {
          const stored = await deps.sessions.get(candidate.session.id);
          const replay = stored && (await deps.sessions.replay(stored.id, frame.d.seq, stored.seq));
          if (!replay || isClosed()) return false;
          for (const event of replay) sendRaw(event.frame);
          // Attached inside the queue: later events follow the replay, never precede it.
          candidate.attach(attachment);
          return replay.length;
        })
      : false;
    if (isClosed()) return;
    if (adopted === false || !candidate) {
      // A session on another process, expired, foreign or with a trimmed gap: start over.
      releaseConnection();
      state = 'awaiting-auth';
      identifyTimer = startIdentifyDeadline();
      send({ op: GatewayOp.INVALID_SESSION, d: { resumable: false } });
      return;
    }
    runtime = candidate;
    state = 'ready';
    await candidate.dispatch('RESUMED', { replayed: adopted });
  }

  function onFrame(raw: string) {
    if (!spendOp()) return close(GatewayClose.RATE_LIMITED);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return close(GatewayClose.DECODE_ERROR);
    }
    const parsed = clientFrameSchema.safeParse(json);
    if (!parsed.success) {
      const op = typeof json === 'object' && json !== null && 'op' in json ? json.op : undefined;
      const known =
        op === GatewayOp.HEARTBEAT || op === GatewayOp.IDENTIFY || op === GatewayOp.RESUME;
      return close(known ? GatewayClose.DECODE_ERROR : GatewayClose.UNKNOWN_OPCODE);
    }
    const frame = parsed.data;
    if (frame.op === GatewayOp.HEARTBEAT) {
      if (state === 'awaiting-auth') return close(GatewayClose.NOT_AUTHENTICATED);
      // Heartbeats during an in-flight IDENTIFY/RESUME are fine; they just keep the link alive.
      armHeartbeatDeadline();
      send({ op: GatewayOp.HEARTBEAT_ACK, d: {} });
      const current = runtime;
      if (current) void current.run(() => deps.sessions.touch(current.session.id));
      heartbeats += 1;
      // A kick can be lost while Valkey pub/sub reconnects: re-check the session now and then.
      if (current && heartbeats % REVALIDATE_EVERY_HEARTBEATS === 0) {
        void deps.isAuthSessionActive(current.session.authSessionId).then((active) => {
          if (!active) close(GatewayClose.AUTHENTICATION_FAILED);
        });
      }
      return;
    }
    if (state !== 'awaiting-auth') return close(GatewayClose.ALREADY_AUTHENTICATED);
    clearTimeout(identifyTimer);
    armHeartbeatDeadline();
    state = 'authenticating';
    const task = frame.op === GatewayOp.IDENTIFY ? identify(frame) : resume(frame);
    task.catch((error: unknown) => {
      deps.log.warn({ err: error }, 'gateway handshake failed');
      close(GatewayClose.UNKNOWN_ERROR);
    });
  }

  socket.on('message', (data, isBinary) => {
    if (isBinary) return close(GatewayClose.DECODE_ERROR);
    onFrame(data.toString());
  });

  // `ws` reports protocol violations (e.g. oversize frames) here and closes the socket itself.
  socket.on('error', () => {
    state = 'closed';
  });

  socket.on('close', () => {
    state = 'closed';
    clearTimeout(identifyTimer);
    clearTimeout(heartbeatTimer);
    releaseConnection();
    runtime?.detach(attachment);
  });

  send({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: options.heartbeatIntervalMs } });
}
