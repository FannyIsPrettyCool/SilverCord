import { errorEnvelopeSchema } from '@silvercord/protocol';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createMemoryRateLimiter as memoryLimiter } from '../../test/memory-rate-limiter.ts';
import { registerErrorHandling } from './error-handler.ts';
import { MissingRateLimitError, perBodyField, perIp, registerRateLimiting } from './rate-limit.ts';

describe('rate limiting plugin', () => {
  it('rejects routes without a rateLimit declaration', async () => {
    const app = Fastify({ logger: false });
    registerRateLimiting(app, memoryLimiter());
    expect(() => app.get('/naked', () => 'x')).toThrow(MissingRateLimitError);
    await app.close();
  });

  it('enforces route rules after the global bucket and returns the envelope', async () => {
    const app = Fastify({ logger: false });
    const limiter = memoryLimiter();
    registerErrorHandling(app);
    registerRateLimiting(app, limiter);
    app.get(
      '/login',
      { config: { rateLimit: [perIp('auth.login', { capacity: 2, refillPerSecond: 1 })] } },
      () => 'ok',
    );
    await app.ready();

    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await app.inject({ method: 'GET', url: '/login' })).statusCode);
    expect(statuses).toEqual([200, 200, 429]);

    const limited = await app.inject({ method: 'GET', url: '/login' });
    expect(limited.headers['retry-after']).toBe('2');
    expect(errorEnvelopeSchema.parse(limited.json()).error.code).toBe('RATE_LIMITED');
    expect(limiter.keys.slice(0, 2)).toEqual(['global:127.0.0.1', 'auth.login:127.0.0.1']);
    await app.close();
  });

  it('skips rules whose key is null', async () => {
    const app = Fastify({ logger: false });
    const limiter = memoryLimiter();
    registerRateLimiting(app, limiter);
    const never = { name: 'user', policy: { capacity: 0, refillPerSecond: 1 }, key: () => null };
    app.get('/anon', { config: { rateLimit: [never] } }, () => 'ok');
    expect((await app.inject({ method: 'GET', url: '/anon' })).statusCode).toBe(200);
    await app.close();
  });

  it('keys rules on a body field across IPs', async () => {
    const app = Fastify({ logger: false });
    const limiter = memoryLimiter();
    registerRateLimiting(app, limiter);
    const rule = perBodyField('auth.login.account', { capacity: 1, refillPerSecond: 1 }, 'login');
    app.post('/login', { config: { rateLimit: [rule] } }, () => 'ok');
    const send = (login: unknown, ip: string) =>
      app.inject({ method: 'POST', url: '/login', payload: { login }, remoteAddress: ip });
    expect((await send('Fanny', '10.0.0.1')).statusCode).toBe(200);
    expect((await send(' fanny', '10.0.0.2')).statusCode).toBe(429);
    expect((await send('other', '10.0.0.3')).statusCode).toBe(200);
    expect((await send(42, '10.0.0.4')).statusCode).toBe(200);
    await send('x'.repeat(100_000), '10.0.0.5');
    const keyed = limiter.keys.filter((key) => key.startsWith('auth.login.account:'));
    expect(keyed).toHaveLength(4);
    expect(keyed.at(-1)).toBe('auth.login.account:oversize');
    // Values are hashed: keys stay small whatever the client sends.
    expect(limiter.keys.every((key) => key.length < 80)).toBe(true);
    await app.close();
  });
});

describe('trusted proxy hop', () => {
  it('uses the address the proxy appended, not client-supplied ones', async () => {
    const app = Fastify({
      logger: false,
      trustProxy: (_address: string, hop: number) => hop === 0,
    });
    app.get('/ip', (request) => request.ip);
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
      remoteAddress: '127.0.0.1',
    });
    expect(response.body).toBe('203.0.113.9');
    await app.close();
  });
});
