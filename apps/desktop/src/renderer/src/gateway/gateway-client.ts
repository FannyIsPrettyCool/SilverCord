import { GatewayClose, GatewayOp, serverFrameSchema } from '@silvercord/protocol';
import { DesktopError } from '../desktop.ts';

export type GatewayState = 'idle' | 'connecting' | 'ready' | 'closed';

/** The subset of WebSocket the client needs, so tests can drive it. */
export interface GatewaySocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export interface GatewayClientOptions {
  readonly url: string;
  /** Returns a usable access token (the main process refreshes it when needed). */
  readonly getToken: () => Promise<string>;
  readonly createSocket?: (url: string) => GatewaySocket;
  readonly random?: () => number;
  readonly client?: { name: string; version: string; os: string };
  readonly onState?: (state: GatewayState) => void;
  readonly onDispatch?: (t: string, d: unknown) => void;
  /** Authentication can't be recovered (revoked session): the app signs out. */
  readonly onUnauthenticated?: () => void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000] as const;
const OPEN = 1;
const SESSION_ENDING = new Set([
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'UNAUTHENTICATED',
]);

/** Codes after which resuming is pointless and a fresh IDENTIFY is needed. */
const IDENTIFY_AGAIN = new Set<number>([GatewayClose.NOT_AUTHENTICATED]);

/**
 * Client side of docs/spec/gateway.md: identifies or resumes, heartbeats with zombie
 * detection, reconnects with jittered backoff, and refreshes the token once on auth failure.
 */
export function createGatewayClient(options: GatewayClientOptions) {
  const random = options.random ?? Math.random;
  const createSocket =
    options.createSocket ?? ((url) => new WebSocket(url) as unknown as GatewaySocket);
  let socket: GatewaySocket | null = null;
  let state: GatewayState = 'idle';
  let sessionId: string | null = null;
  let seq: number | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let acknowledged = true;
  let heartbeatIntervalMs = 0;
  let attempt = 0;
  let authFailures = 0;
  let stopped = false;

  const setState = (next: GatewayState) => {
    if (state === next) return;
    state = next;
    options.onState?.(next);
  };

  const send = (frame: unknown) => {
    if (socket?.readyState === OPEN) socket.send(JSON.stringify(frame));
  };

  function stopHeartbeat() {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  function startHeartbeat(intervalMs: number) {
    stopHeartbeat();
    acknowledged = true;
    const beat = () => {
      if (!acknowledged) {
        // No ACK since the last beat: the connection is a zombie. Drop it and resume.
        if (socket) drop(socket, 4000);
        return;
      }
      acknowledged = false;
      send({ op: GatewayOp.HEARTBEAT, d: { seq } });
      heartbeatTimer = setTimeout(beat, intervalMs);
    };
    // First beat after a random fraction of the interval spreads reconnect storms.
    heartbeatTimer = setTimeout(beat, intervalMs * random());
  }

  async function authenticate(current: GatewaySocket) {
    try {
      const token = await options.getToken();
      // Token refresh can outlive the connection that requested it.
      if (stopped || socket !== current || current.readyState !== OPEN) return;
      const client = options.client ?? { name: 'desktop', version: '0.0.0', os: 'unknown' };
      if (sessionId !== null && seq !== null) {
        send({ op: GatewayOp.RESUME, d: { token, sessionId, seq } });
      } else {
        send({ op: GatewayOp.IDENTIFY, d: { token, client } });
      }
    } catch (error) {
      if (stopped || socket !== current) return;
      if (error instanceof DesktopError && SESSION_ENDING.has(error.code)) {
        stopped = true;
        drop(current, 1000);
        options.onUnauthenticated?.();
      } else {
        // Network errors, rate limits and server failures leave the login session intact.
        drop(current, 4000);
      }
    }
  }

  function handleMessage(current: GatewaySocket, raw: unknown) {
    let json: unknown;
    try {
      json = JSON.parse(String(raw));
    } catch {
      return;
    }
    const parsed = serverFrameSchema.safeParse(json);
    if (!parsed.success) return;
    const frame = parsed.data;
    switch (frame.op) {
      case GatewayOp.HELLO:
        heartbeatIntervalMs = frame.d.heartbeatIntervalMs;
        void authenticate(current);
        return;
      case GatewayOp.HEARTBEAT_ACK:
        acknowledged = true;
        return;
      case GatewayOp.INVALID_SESSION:
        sessionId = null;
        seq = null;
        stopHeartbeat();
        setState('connecting');
        void authenticate(current);
        return;
      case GatewayOp.RECONNECT:
        drop(current, 4000);
        return;
      case GatewayOp.DISPATCH:
        seq = frame.s;
        if (frame.t === 'READY' || frame.t === 'RESUMED') {
          if (frame.t === 'READY') {
            const data = frame.d as { sessionId?: unknown };
            sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
          }
          attempt = 0;
          authFailures = 0;
          setState('ready');
          startHeartbeat(heartbeatIntervalMs);
        }
        options.onDispatch?.(frame.t, frame.d);
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    attempt += 1;
    reconnectTimer = setTimeout(open, base * (0.75 + random() * 0.5));
  }

  function drop(current: GatewaySocket, code: number) {
    if (socket !== current) return;
    // Detach immediately: the browser's close handshake can take many seconds on a dead link.
    current.onmessage = null;
    current.onclose = null;
    handleClose(code);
    current.close(code);
  }

  function handleClose(code: number) {
    stopHeartbeat();
    socket = null;
    if (stopped) {
      setState('closed');
      return;
    }
    if (code === GatewayClose.AUTHENTICATION_FAILED) {
      sessionId = null;
      seq = null;
      authFailures += 1;
      if (authFailures >= 2) {
        stopped = true;
        setState('closed');
        options.onUnauthenticated?.();
        return;
      }
    }
    if (IDENTIFY_AGAIN.has(code)) {
      sessionId = null;
      seq = null;
    }
    setState('connecting');
    scheduleReconnect();
  }

  function open() {
    reconnectTimer = undefined;
    if (stopped) return;
    setState('connecting');
    const current = createSocket(options.url);
    socket = current;
    heartbeatIntervalMs = 0;
    current.onmessage = (event) => {
      if (socket === current) handleMessage(current, event.data);
    };
    current.onclose = (event) => {
      if (socket === current) handleClose(event.code);
    };
  }

  return {
    get state() {
      return state;
    },
    start() {
      if (socket || reconnectTimer !== undefined) return;
      stopped = false;
      open();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      stopHeartbeat();
      socket?.close(1000);
      socket = null;
      setState('closed');
    },
  };
}

export type GatewayClient = ReturnType<typeof createGatewayClient>;
