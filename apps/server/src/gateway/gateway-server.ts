import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { GATEWAY_MAX_INBOUND_BYTES, GATEWAY_PATH } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import { clientSubject } from '../http/client-subject.ts';
import type { RateLimiter } from '../infra/rate-limiter.ts';
import {
  type ConnectionDependencies,
  type GatewayOptions,
  type GatewayState,
  handleConnection,
} from './gateway-connection.ts';

export const DEFAULT_GATEWAY_OPTIONS: GatewayOptions = {
  heartbeatIntervalMs: 41_250,
  identifyTimeoutMs: 10_000,
  opsPerMinute: 120,
  maxConnectionsPerUser: 10,
};

/** Upgrade budget per client IP: sockets cost memory before they even authenticate. */
const UPGRADE_POLICY = { capacity: 30, refillPerSecond: 0.5 } as const;
const MAX_SOCKETS_PER_IP = 50;

export interface GatewayServerDependencies extends Omit<ConnectionDependencies, 'state'> {
  readonly rateLimiter: RateLimiter;
  /** Same semantics as Fastify's `trustProxy`: only behind Caddy. */
  readonly trustProxy: boolean;
}

/**
 * With one trusted proxy (Caddy) the client is the last X-Forwarded-For hop; earlier entries
 * are whatever the client sent and must not be trusted (Fastify uses the same rule, trustProxy: 1).
 */
function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (trustProxy && typeof forwarded === 'string') {
    const last = forwarded.split(',').at(-1)?.trim();
    if (last) return last;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/** Path of a raw request target, without `new URL` (which throws on hostile input). */
function requestPath(url: string | undefined): string {
  return (url ?? '/').split('?')[0] ?? '/';
}

/** Serves the gateway on the HTTP server's upgrade path (docs/spec/gateway.md). */
export function registerGateway(
  app: FastifyInstance,
  deps: GatewayServerDependencies,
  options: GatewayOptions = DEFAULT_GATEWAY_OPTIONS,
): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: GATEWAY_MAX_INBOUND_BYTES,
    perMessageDeflate: { threshold: 1024 },
  });
  const state: GatewayState = { runtimes: new Map(), connectionsPerUser: new Map() };
  const socketsPerIp = new Map<string, number>();
  const sockets = new Set<Duplex>();
  const { rateLimiter, trustProxy, ...connectionDeps } = deps;

  const refuse = (socket: { write(data: string): void; destroy(): void }, status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  const release = (subject: string) => {
    const count = (socketsPerIp.get(subject) ?? 1) - 1;
    if (count <= 0) socketsPerIp.delete(subject);
    else socketsPerIp.set(subject, count);
  };

  app.server.on('upgrade', (request, socket, head) => {
    socket.once('error', () => socket.destroy());
    try {
      if (requestPath(request.url) !== GATEWAY_PATH) {
        socket.destroy();
        return;
      }
      const subject = clientSubject(clientIp(request, trustProxy));
      // Reserve synchronously: concurrent upgrades must not all pass the cap check.
      const count = socketsPerIp.get(subject) ?? 0;
      if (count >= MAX_SOCKETS_PER_IP) {
        refuse(socket, '429 Too Many Requests');
        return;
      }
      socketsPerIp.set(subject, count + 1);
      sockets.add(socket);
      let released = false;
      const releaseReservation = () => {
        if (released) return;
        released = true;
        sockets.delete(socket);
        release(subject);
      };
      // A refused handshake never creates a WebSocket. The raw socket owns the reservation,
      // including when its peer disconnects while the rate-limit request is pending.
      socket.once('close', releaseReservation);
      socket.once('end', () => socket.destroy());
      rateLimiter
        .consume(`gw.upgrade:${subject}`, UPGRADE_POLICY)
        .then((result) => {
          if (socket.destroyed) return;
          if (!result.allowed) {
            releaseReservation();
            refuse(socket, '429 Too Many Requests');
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            handleConnection(ws, { ...connectionDeps, state }, options);
          });
        })
        .catch(() => {
          releaseReservation();
          if (!socket.destroyed) refuse(socket, '503 Service Unavailable');
        });
    } catch {
      socket.destroy();
    }
  });

  // preClose runs before HTTP server.close waits for upgraded sockets to finish.
  app.addHook('preClose', async () => {
    for (const client of wss.clients) client.terminate();
    for (const socket of sockets) socket.destroy();
    await Promise.all([...state.runtimes.values()].map((runtime) => runtime.dispose()));
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
}
