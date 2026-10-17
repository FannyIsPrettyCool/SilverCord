import type { IncomingMessage } from 'node:http';
import { GATEWAY_MAX_INBOUND_BYTES, GATEWAY_PATH } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
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

function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (trustProxy && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
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
  const { rateLimiter, trustProxy, ...connectionDeps } = deps;

  const refuse = (socket: { write(data: string): void; destroy(): void }, status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  app.server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', 'http://gateway');
    if (pathname !== GATEWAY_PATH) {
      socket.destroy();
      return;
    }
    const ip = clientIp(request, trustProxy);
    if ((socketsPerIp.get(ip) ?? 0) >= MAX_SOCKETS_PER_IP) {
      refuse(socket, '429 Too Many Requests');
      return;
    }
    rateLimiter
      .consume(`gw.upgrade:${ip}`, UPGRADE_POLICY)
      .then((result) => {
        if (!result.allowed) return refuse(socket, '429 Too Many Requests');
        wss.handleUpgrade(request, socket, head, (ws) => {
          socketsPerIp.set(ip, (socketsPerIp.get(ip) ?? 0) + 1);
          ws.once('close', () => {
            const count = (socketsPerIp.get(ip) ?? 1) - 1;
            if (count <= 0) socketsPerIp.delete(ip);
            else socketsPerIp.set(ip, count);
          });
          handleConnection(ws, { ...connectionDeps, state }, options);
        });
      })
      .catch(() => refuse(socket, '503 Service Unavailable'));
  });

  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    await Promise.all([...state.runtimes.values()].map((runtime) => runtime.dispose()));
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
}
