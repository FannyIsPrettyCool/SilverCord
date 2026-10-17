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
  readonly state: GatewayState;
  readonly log: { warn(object: object, message: string): void };
}

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

  async function identify(frame: Extract<ClientFrame, { op: 2 }>) {
    const claims = await authenticate(frame.d.token);
    if (!claims || state === 'closed') return;
    const user = await deps.loadUser(claims.userId);
    const session = await deps.sessions.create(claims.userId, claims.sessionId);
    const created = await createSessionRuntime(session, {
      sessions: deps.sessions,
      subscriber: deps.subscriber,
      onError: (error) => deps.log.warn({ err: error }, 'gateway session task failed'),
      onDisposed: (disposed) => runtimes.delete(disposed.session.id),
    });
    runtimes.set(session.id, created);
    runtime = created;
    created.attach(attachment);
    state = 'ready';
    await created.dispatch('READY', {
      sessionId: session.id,
      user,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
    });
  }

  async function resume(frame: Extract<ClientFrame, { op: 3 }>) {
    const claims = await authenticate(frame.d.token);
    if (!claims || state === 'closed') return;
    const candidate = runtimes.get(frame.d.sessionId);
    const adopted =
      candidate && candidate.session.userId === claims.userId
        ? await candidate.run(async () => {
            const stored = await deps.sessions.get(candidate.session.id);
            const replay =
              stored && (await deps.sessions.replay(stored.id, frame.d.seq, stored.seq));
            if (!replay) return false;
            for (const event of replay) sendRaw(event.frame);
            // Attached inside the queue: later events follow the replay, never precede it.
            candidate.attach(attachment);
            return replay.length;
          })
        : false;
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
      if (state !== 'ready' || !runtime) return close(GatewayClose.NOT_AUTHENTICATED);
      armHeartbeatDeadline();
      send({ op: GatewayOp.HEARTBEAT_ACK, d: {} });
      const id = runtime.session.id;
      void runtime.run(() => deps.sessions.touch(id));
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
