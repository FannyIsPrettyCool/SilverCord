import { request } from 'node:http';
import { connect } from 'node:net';
import { setImmediate as immediate } from 'node:timers/promises';
import { GATEWAY_PATH, GatewayClose, GatewayOp } from '@silvercord/protocol';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { TestGatewayClient } from '../../test/gateway-client.ts';
import type { ConsumeResult, RateLimiter } from '../infra/rate-limiter.ts';
import { createTokenIssuer } from '../modules/auth/crypto/access-tokens.ts';
import { registerGateway } from './gateway-server.ts';

const allowed: ConsumeResult = { allowed: true, remaining: 100, retryAfterMs: 0 };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  vi.restoreAllMocks();
});

async function fixture(rateLimiter: RateLimiter = { consume: async () => allowed }) {
  const app = Fastify();
  const warn = vi.fn();
  const isAuthSessionActive = vi.fn(async () => true);
  let seq = 0;
  registerGateway(app, {
    rateLimiter,
    trustProxy: false,
    tokens: createTokenIssuer('unit-test-jwt-secret-0123456789abcdef'),
    revocations: { isRevoked: async () => false, revoke: async () => {} },
    subscriber: { subscribe: async () => async () => {}, close: async () => {} },
    sessions: {
      create: async (userId, authSessionId) => ({ id: 'session', userId, authSessionId, seq: 0 }),
      get: async () => null,
      append: async (_id, build) => build(++seq),
      replay: async () => [],
      touch: async () => {},
      destroy: async () => {},
    },
    loadUser: async () => ({
      id: '1',
      username: 'test',
      displayName: null,
      email: 'test@example.com',
      emailVerified: true,
      isInstanceAdmin: false,
      mfaEnabled: false,
      locale: 'en',
      createdAt: new Date().toISOString(),
    }),
    isAuthSessionActive,
    log: { warn },
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  cleanups.push(() => app.close());
  return { app, url, warn, isAuthSessionActive };
}

describe('gateway transport failures', () => {
  it('does not permanently consume the IP socket allowance on malformed upgrades', async () => {
    const { url } = await fixture();
    for (let i = 0; i < 55; i++) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          `${url}${GATEWAY_PATH}`,
          {
            headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13' },
          },
          (response) => {
            response.resume();
            response.once('end', () => resolve(response.statusCode));
          },
        );
        req.once('error', reject);
        req.end();
      });
      expect(status).toBe(400);
    }
    const client = await TestGatewayClient.connect(url);
    await client.close();
  });

  it('releases aborted upgrades while their rate-limit request is still pending', async () => {
    const pending: ((value: ConsumeResult) => void)[] = [];
    const consume = vi.fn(() => new Promise<ConsumeResult>((resolve) => pending.push(resolve)));
    const { url } = await fixture({ consume });
    const port = Number(new URL(url).port);
    const upgrade = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade');
    for (let i = 0; i < 50; i++) {
      const socket = connect(port, '127.0.0.1');
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.write(
        `GET ${GATEWAY_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
      await vi.waitFor(() => expect(pending.length).toBe(i + 1));
      socket.destroy();
      await closed;
    }
    consume.mockImplementation(async () => allowed);
    const client = await TestGatewayClient.connect(url);
    await client.close();
    upgrade.mockClear();
    for (const resolve of pending) resolve(allowed);
    await immediate();
    expect(upgrade).not.toHaveBeenCalled();
  }, 10_000);

  it('logs session revalidation errors and closes recoverably without an unhandled rejection', async () => {
    const { url, warn, isAuthSessionActive } = await fixture();
    const client = await TestGatewayClient.connect(url);
    const issuer = createTokenIssuer('unit-test-jwt-secret-0123456789abcdef');
    client.identify((await issuer.issueAccessToken({ userId: 1n, sessionId: 2n })).token);
    await client.dispatch('READY');
    isAuthSessionActive.mockRejectedValue(new Error('database disconnected'));
    for (let i = 0; i < 5; i++) client.send({ op: GatewayOp.HEARTBEAT, d: { seq: 1 } });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 300 });
    expect(await client.closed).toBe(GatewayClose.UNKNOWN_ERROR);
    expect(isAuthSessionActive).toHaveBeenCalledWith(2n);
  });

  it('rejects revoked sessions even when the revocation cache is empty', async () => {
    const { url, isAuthSessionActive } = await fixture();
    isAuthSessionActive.mockResolvedValue(false);
    const issuer = createTokenIssuer('unit-test-jwt-secret-0123456789abcdef');
    for (const resume of [false, true]) {
      const client = await TestGatewayClient.connect(url);
      const { token } = await issuer.issueAccessToken({ userId: 1n, sessionId: 2n });
      if (resume) client.resume(token, 'session', 1);
      else client.identify(token);
      expect(await client.closed).toBe(GatewayClose.AUTHENTICATION_FAILED);
    }
  });

  it('closes recoverably when authoritative validation fails during authentication', async () => {
    const { url, warn, isAuthSessionActive } = await fixture();
    isAuthSessionActive.mockRejectedValue(new Error('database disconnected'));
    const client = await TestGatewayClient.connect(url);
    const issuer = createTokenIssuer('unit-test-jwt-secret-0123456789abcdef');
    client.identify((await issuer.issueAccessToken({ userId: 1n, sessionId: 2n })).token);
    expect(await client.closed).toBe(GatewayClose.UNKNOWN_ERROR);
    expect(warn).toHaveBeenCalled();
  });

  it('can shut down while a WebSocket is still connected', async () => {
    const { app, url } = await fixture();
    const client = await TestGatewayClient.connect(url);
    await app.close();
    expect(await client.closed).toBe(1006);
  }, 1000);
});
