import { GATEWAY_MAX_INBOUND_BYTES, GATEWAY_PATH } from '@silvercord/protocol';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
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

/** Serves the gateway on the HTTP server's upgrade path (docs/spec/gateway.md). */
export function registerGateway(
  app: FastifyInstance,
  deps: Omit<ConnectionDependencies, 'state'>,
  options: GatewayOptions = DEFAULT_GATEWAY_OPTIONS,
): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: GATEWAY_MAX_INBOUND_BYTES,
    perMessageDeflate: { threshold: 1024 },
  });
  const state: GatewayState = { runtimes: new Map(), connectionsPerUser: new Map() };

  app.server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', 'http://gateway');
    if (pathname !== GATEWAY_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      handleConnection(ws, { ...deps, state }, options),
    );
  });

  app.addHook('onClose', async () => {
    for (const client of wss.clients) client.terminate();
    await Promise.all([...state.runtimes.values()].map((runtime) => runtime.dispose()));
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
}
